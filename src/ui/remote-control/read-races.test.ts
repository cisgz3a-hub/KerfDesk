import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { createLayer } from '../../core/scene';
import type { RemoteControlAdapter, SafeRemoteJobReview } from './types';
import { resultCode, testAdapter } from './authoring-test-support';

const preview = vi.hoisted(() => vi.fn());
vi.mock('./preview-projection', () => ({ workspacePreviewProjection: preview }));
let adapter: RemoteControlAdapter;
let finishPreview: (value: Record<string, unknown>) => void;
let finishReview: (value: SafeRemoteJobReview) => void;
let share = true;
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  share = true;
  preview.mockReset().mockImplementation(
    () =>
      new Promise<Record<string, unknown>>((resolve) => {
        finishPreview = resolve;
      }),
  );
  adapter = testAdapter({ canShareArtwork: () => share });
});
afterEach(() => adapter.dispose());
const pixels = {
  status: 'ready',
  preview: { mimeType: 'image/png', dataBase64: 'PRIVATE_PIXELS', width: 10, height: 10 },
};
async function rendering() {
  await vi.waitFor(() => expect(preview).toHaveBeenCalledTimes(1));
}

describe('asynchronous read snapshots fail closed', () => {
  it('scrubs converted-text review labels after opt-out without a second provider call', async () => {
    adapter.dispose();
    const state = useStore.getState();
    const label = 'Private design words';
    useStore.setState({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          layers: [createLayer({ id: 'prepared-layer', color: '#000000', name: label })],
        },
      },
    });
    const getReview = vi.fn((revision: string) =>
      Promise.resolve<SafeRemoteJobReview>({
        revision,
        status: 'ready',
        mode: 'laser',
        message: `Review ${label} on the computer.`,
        warnings: [
          { code: 'advisory', message: `Check operation ${label} for speed.`, severity: 'warning' },
        ],
        frame: { required: true, complete: false },
      }),
    );
    adapter = testAdapter({ canShareArtwork: () => share, getReview });
    const pending = adapter.execute('review_job', {});
    queueMicrotask(() => {
      share = false;
    });
    const result = await pending;
    expect(resultCode(result)).toBe('ok');
    expect(JSON.stringify(result)).not.toContain(label);
    expect(result).toMatchObject({ ok: true, data: { warnings: [{ code: 'advisory' }] } });
    expect(getReview).toHaveBeenCalledTimes(1);
  });
  it('returns a disabled preview with no pixels if sharing turns off during rendering', async () => {
    const pending = adapter.execute('get_workspace_preview', {});
    await rendering();
    share = false;
    finishPreview(pixels);
    const result = await pending;
    expect(result).toMatchObject({ ok: true, data: { status: 'disabled' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PIXELS');
  });

  it.each(['document', 'dispose', 'abort'] as const)('rejects preview after %s', async (action) => {
    const controller = new AbortController();
    const pending = adapter.execute('get_workspace_preview', {}, { signal: controller.signal });
    await rendering();
    if (action === 'document') useStore.getState().newProject();
    if (action === 'dispose') adapter.dispose();
    if (action === 'abort') controller.abort();
    finishPreview(pixels);
    expect(resultCode(await pending)).toBe(action === 'document' ? 'stale_revision' : 'cancelled');
  });

  it('passes exact revision and abort signal to a real review provider and fences a changed document', async () => {
    adapter.dispose();
    const getReview = vi.fn(
      (revision: string, signal?: AbortSignal) =>
        new Promise<SafeRemoteJobReview>((resolve) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          expect(revision).toBe(adapter.getRevision());
          finishReview = resolve;
        }),
    );
    adapter = testAdapter({ getReview });
    const revision = adapter.getRevision();
    const pending = adapter.execute('review_job', {});
    await vi.waitFor(() => expect(getReview).toHaveBeenCalledTimes(1));
    useStore.getState().newProject();
    finishReview({
      revision,
      status: 'ready',
      mode: 'laser',
      warnings: [],
      frame: { required: true, complete: false },
    });
    expect(resultCode(await pending)).toBe('stale_revision');
  });
});
