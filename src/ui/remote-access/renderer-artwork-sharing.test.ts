import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RemoteControlOptions,
  RemoteCommandResult,
  SafeRemoteJobReview,
} from '../remote-control/types';
import { reviewProjection } from '../remote-control/status-projections';
import { useStore } from '../state/store';
import { createLayer } from '../../core/scene';
import { RemoteRendererSession } from './renderer-session';
import { ARTWORK_SHARING_KEY, setArtworkSharingEnabled } from './artwork-sharing';
import {
  REMOTE_REVOKE_EVENT,
  setRemoteSession,
  useRemoteAccessStore,
  type RemoteAccessStatus,
} from './remote-access-store';

const captured = vi.hoisted(() => ({
  options: null as RemoteControlOptions | null,
  execute:
    vi.fn<
      (
        command: string,
        args: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<RemoteCommandResult>
    >(),
  revision: 'r1',
}));
vi.mock('../remote-control/adapter', () => ({
  createRemoteControlAdapter: (options: RemoteControlOptions) => {
    captured.options = options;
    return { execute: captured.execute, dispose: vi.fn(), getRevision: () => captured.revision };
  },
}));
const status: RemoteAccessStatus = {
  statusRevision: 1,
  available: true,
  enabled: true,
  connected: true,
  deviceId: 'device',
  controlUrl: 'https://example.test/control',
  mcpUrl: 'https://example.test/mcp',
  pairing: null,
  pairingPending: false,
  requests: [],
  error: null,
  clients: [{ id: 'client', label: 'Approved', scopes: ['read', 'edit'] }],
};
const result: RemoteCommandResult = { ok: true, revision: 'r1', data: {} };
const envelope = (command: string, id = command) => ({
  id,
  command,
  args: {},
  clientId: 'client',
  canWrite: true,
});
let polls: unknown[];
let completions: RemoteCommandResult[];
let session: RemoteRendererSession;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  captured.revision = 'r1';
  useStore.setState(useStore.getInitialState(), true);
  setRemoteSession(null);
  useRemoteAccessStore.setState({ status: null, message: null, busy: false });
  setArtworkSharingEnabled(true);
  polls = [];
  completions = [];
  captured.execute.mockResolvedValue(result);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split('/').at(-1);
      const body = JSON.parse(String(init?.body)) as { result?: RemoteCommandResult };
      if (action === 'attach') return Response.json({ sessionId: 'session' });
      if (action === 'poll')
        return Response.json(polls.shift() ?? { status, requests: [], cancelled: [] });
      if (action === 'complete' && body.result !== undefined) completions.push(body.result);
      return Response.json({ accepted: true });
    }),
  );
  session = new RemoteRendererSession();
});
afterEach(() => {
  session.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start(command: string): Promise<void> {
  polls.push({ status, requests: [envelope(command)], cancelled: [] });
  await session.start();
  await vi.advanceTimersByTimeAsync(0);
}
function deferred() {
  let resolve!: (value: RemoteCommandResult) => void;
  const promise = new Promise<RemoteCommandResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function namedOperation(name: string): void {
  const state = useStore.getState();
  useStore.setState({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        layers: [createLayer({ id: 'private-op', color: '#000000', name })],
      },
    },
  });
}

describe('artwork disclosure is fenced at renderer delivery', () => {
  it('desktop opt-out cancels both active and queued artwork reads', async () => {
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    await start('get_workspace_preview');
    polls.push({ status, requests: [envelope('get_text')], cancelled: [] });
    await vi.advanceTimersByTimeAsync(350);
    setArtworkSharingEnabled(false);
    held.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.execute.mock.calls.every((call) => call[2]!.signal!.aborted)).toBe(true);
    expect(completions.every((item) => !item.ok)).toBe(true);
  });
  it('ordinary summaries remain available with generic operation labels after opt-out', async () => {
    namedOperation('Private converted text');
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    await start('get_workspace');
    setArtworkSharingEnabled(false);
    expect(captured.execute.mock.calls[0]![2]!.signal!.aborted).toBe(false);
    held.resolve({
      ok: true,
      revision: 'r1',
      data: { operations: [{ name: 'Private converted text' }] },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(completions[0]?.ok).toBe(true);
    expect(JSON.stringify(completions)).not.toContain('Private converted text');
    expect(JSON.stringify(completions)).toContain('Operation');
    expect(completions[0]).toMatchObject({
      data: {
        history: { canUndo: false, canRedo: false },
        permissions: { canEdit: true, artworkSharingEnabled: false },
      },
    });
  });
  it('another window can revoke sharing through the storage event', async () => {
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    await start('get_workspace_preview');
    localStorage.setItem(ARTWORK_SHARING_KEY, 'false');
    window.dispatchEvent(
      new StorageEvent('storage', { key: ARTWORK_SHARING_KEY, newValue: 'false' }),
    );
    expect(captured.execute.mock.calls[0]![2]!.signal!.aborted).toBe(true);
    held.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
  });
  it.each(['get_text', 'get_workspace_preview'])(
    'refuses %s if opt-out arrives after adapter resolution',
    async (command) => {
      captured.execute.mockImplementation(async () => {
        queueMicrotask(() => setArtworkSharingEnabled(false));
        return {
          ok: true,
          revision: 'r1',
          data: { text: 'PRIVATE SOURCE', status: 'ready', preview: { data: 'PRIVATE PNG' } },
        };
      });
      await start(command);
      expect(captured.execute.mock.calls[0]![2]!.signal!.aborted).toBe(true);
      expect(completions[0]).toMatchObject({ ok: false, error: { code: 'cancelled' } });
      expect(JSON.stringify(completions)).not.toContain('PRIVATE');
    },
  );
  it('redacts workspace labels if opt-out arrives after adapter resolution', async () => {
    namedOperation('PRIVATE WORKSPACE TITLE');
    captured.execute.mockImplementation(async () => {
      queueMicrotask(() => setArtworkSharingEnabled(false));
      return {
        ok: true,
        revision: 'r1',
        data: { operations: [{ name: 'PRIVATE WORKSPACE TITLE' }] },
      };
    });
    await start('get_workspace');
    expect(completions[0]?.ok).toBe(true);
    expect(JSON.stringify(completions)).not.toContain('PRIVATE');
  });
  it('re-redacts the full prepared warning at delivery with a single review-provider call', async () => {
    const title = 'PRIVATE CONVERTED TITLE '.repeat(30).trim();
    namedOperation(title);
    const review: SafeRemoteJobReview = {
      revision: 'r1',
      mode: 'laser',
      status: 'ready',
      warnings: [
        {
          code: 'job-review-1',
          severity: 'warning',
          message: `Layer "${title}": extends outside the machine bed by 8 mm.`,
        },
      ],
      frame: { required: true, complete: false },
    };
    const provider = vi.fn(() => review);
    captured.execute.mockImplementation(async () => {
      const data = await reviewProjection(
        { ...captured.options!, getReview: provider },
        'r1',
        'laser',
      );
      queueMicrotask(() => setArtworkSharingEnabled(false));
      return { ok: true, revision: 'r1', data };
    });
    await start('review_job');
    expect(completions[0]).toMatchObject({
      ok: true,
      data: {
        warnings: [{ message: 'Layer "artwork": extends outside the machine bed by 8 mm.' }],
      },
    });
    expect(JSON.stringify(completions)).not.toContain('PRIVATE');
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('retains an authoritative committed write receipt after local cancellation', async () => {
    captured.execute.mockImplementation(async () => {
      queueMicrotask(() =>
        window.dispatchEvent(
          new CustomEvent(REMOTE_REVOKE_EVENT, { detail: { clientId: 'client' } }),
        ),
      );
      return { ok: true, revision: 'r1', data: { artworkId: 'created' } };
    });
    await start('add_text');
    expect(captured.execute.mock.calls[0]![2]!.signal!.aborted).toBe(true);
    expect(completions[0]).toEqual({ ok: true, revision: 'r1', data: { artworkId: 'created' } });
  });
  it('rejects a read whose revision changed after adapter resolution', async () => {
    captured.execute.mockImplementation(async () => {
      queueMicrotask(() => {
        captured.revision = 'r2';
      });
      return result;
    });
    await start('get_workspace');
    expect(completions[0]).toMatchObject({
      ok: false,
      revision: 'r2',
      error: { code: 'stale_revision' },
    });
  });
});
