import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StampPreparationDialogHost } from './StampPreparationDialogHost';
import { PlatformProvider } from '../app/platform-context';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { stampFixture } from '../state/stamp-preparation.test-fixture';
import { useStore } from '../state';
import type { StampEncodedDraft } from '../raster/stamp-worker-protocol';
const worker = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('../raster/stamp-worker-client', () => ({ prepareStampInWorker: worker.prepare }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});
async function render() {
  const fixture = stampFixture();
  useStore.setState(fixture.state);
  worker.prepare.mockResolvedValue(fixture.draft);
  const close = vi.fn();
  const write = vi.fn();
  const platform = {
    pickFileForSave: vi.fn(async () => ({ displayName: 'stamp.png', write })),
  } as unknown as PlatformAdapter;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <PlatformProvider adapter={platform}>
        <StampPreparationDialogHost onClose={close} />
      </PlatformProvider>,
    ),
  );
  return { ...fixture, close, write, platform };
}
function button(label: string): HTMLButtonElement {
  return Array.from(container!.querySelectorAll('button')).find(
    (item) => item.textContent === label,
  )!;
}
async function click(label: string): Promise<void> {
  await act(async () => button(label).click());
}
async function review(checked = true): Promise<void> {
  const input = Array.from(
    container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  ).find((item) => item.getAttribute('aria-label') !== 'Mirror raised face')!;
  input.checked = checked;
  await act(async () => Simulate.change(input));
}
describe('stamp preparation review', () => {
  it('prepares an owned preview, requires review and adds a new image preserving the original', async () => {
    const { project, image, close } = await render();
    expect(button('Apply as new image').disabled).toBe(true);
    await click('Prepare preview');
    expect(container!.textContent).toContain('Pixel pitch');
    expect(container!.querySelector('[aria-label="Stamp draft preview"] img')).not.toBeNull();
    expect(useStore.getState().project).toBe(project);
    await review();
    await click('Apply as new image');
    expect(useStore.getState().project.scene.objects[0]).toBe(image);
    expect(useStore.getState().project.scene.objects).toHaveLength(2);
    expect(useStore.getState().undoStack).toEqual([project]);
    expect(close).toHaveBeenCalledOnce();
  });
  it('clears acceptance after settings changes and disables stale document acceptance', async () => {
    const { project } = await render();
    await click('Prepare preview');
    await review();
    const input = container!.querySelector<HTMLInputElement>(
      '[aria-label="Measured taper width (mm)"]',
    )!;
    input.value = '1';
    await act(async () => Simulate.change(input));
    expect(button('Apply as new image').disabled).toBe(true);
    expect(container!.querySelector('[aria-label="Stamp draft preview"]')).toBeNull();
    await click('Prepare preview');
    await review();
    await act(async () => useStore.setState({ projectDocumentEpoch: 25 }));
    expect(button('Apply as new image').disabled).toBe(true);
    await click('Apply as new image');
    expect(useStore.getState().project).toBe(project);
  });
  it('cancels work and rejects a late completion without changing the original', async () => {
    const { project, draft } = await render();
    let finish: (draft: StampEncodedDraft) => void = () => undefined;
    worker.prepare.mockImplementation(
      () =>
        new Promise<StampEncodedDraft>((resolve) => {
          finish = resolve;
        }),
    );
    await click('Prepare preview');
    const signal = worker.prepare.mock.calls[0]?.[1] as AbortSignal;
    await click('Stop preparation');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(draft));
    expect(container!.querySelector('[aria-label="Stamp draft preview"]')).toBeNull();
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toEqual([]);
  });
  it('retires owned work on unmount without accepting its late result', async () => {
    const { project, draft } = await render();
    let finish: (draft: StampEncodedDraft) => void = () => undefined;
    worker.prepare.mockImplementation(
      () =>
        new Promise<StampEncodedDraft>((resolve) => {
          finish = resolve;
        }),
    );
    await click('Prepare preview');
    const signal = worker.prepare.mock.calls[0]?.[1] as AbortSignal;
    await act(async () => root?.unmount());
    root = null;
    expect(signal.aborted).toBe(true);
    await act(async () => finish(draft));
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().undoStack).toEqual([]);
  });
  it('withdraws export intent when review is unchecked during the save picker', async () => {
    const { platform, write, project } = await render();
    let finish: (target: SaveTarget) => void = () => undefined;
    vi.mocked(platform.pickFileForSave).mockImplementation(
      () =>
        new Promise<SaveTarget>((resolve) => {
          finish = resolve;
        }),
    );
    await click('Prepare preview');
    await review();
    await click('Export PNG…');
    await review(false);
    await act(async () => finish({ displayName: 'cancelled.png', write }));
    expect(write).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(project);
  });
});
