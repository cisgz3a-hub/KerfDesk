import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteControlOptions, RemoteCommandResult } from '../remote-control/types';
import { RemoteRendererSession } from './renderer-session';
import { preparedJobReview } from './prepared-job-review';
import { setArtworkSharingEnabled } from './artwork-sharing';
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
        name: string,
        args: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<RemoteCommandResult>
    >(),
  dispose: vi.fn(),
}));
vi.mock('../remote-control/adapter', () => ({
  createRemoteControlAdapter: (options: RemoteControlOptions) => {
    captured.options = options;
    return { execute: captured.execute, dispose: captured.dispose, getRevision: () => 'r1' };
  },
}));

const status: RemoteAccessStatus = {
  statusRevision: 1,
  available: true,
  enabled: true,
  connected: true,
  deviceId: 'device',
  controlUrl: 'https://example.test/control?deviceId=device',
  mcpUrl: 'https://example.test/mcp',
  pairing: null,
  pairingPending: false,
  requests: [],
  clients: [{ id: 'client', label: 'Approved', scopes: ['read', 'edit'] }],
  error: null,
};
const result: RemoteCommandResult = { ok: true, revision: 'r1', data: {} };
const envelope = (id: string, canWrite = true) => ({
  id,
  command: 'add_rectangle',
  args: {},
  clientId: 'client',
  canWrite,
  canControl: false,
});
let polls: unknown[];
let calls: { action: string; body: Record<string, unknown> }[];
let sessions: RemoteRendererSession[];
let attachNumber: number;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setRemoteSession(null);
  useRemoteAccessStore.setState({ status: null, message: null, busy: false });
  setArtworkSharingEnabled(false);
  polls = [];
  calls = [];
  sessions = [];
  attachNumber = 0;
  captured.execute.mockResolvedValue(result);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split('/').at(-1)!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ action, body });
      if (action === 'attach') return Response.json({ sessionId: `session-${++attachNumber}` });
      if (action === 'poll')
        return Response.json(polls.shift() ?? { requests: [], cancelled: [], status });
      return Response.json(action === 'complete' ? { accepted: true } : status);
    }),
  );
});
afterEach(() => {
  for (const session of sessions) session.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function start() {
  const session = new RemoteRendererSession();
  sessions.push(session);
  await session.start();
  await vi.advanceTimersByTimeAsync(0);
  return session;
}
function deferred() {
  let resolve!: (value: RemoteCommandResult) => void;
  const promise = new Promise<RemoteCommandResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('renderer connection owns queued work and cancellation', () => {
  it('completes a replacement delivered with old cancellation after async work settles', async () => {
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    polls.push({ status, requests: [envelope('old')], cancelled: [] });
    await start();
    const signal = captured.execute.mock.calls[0]![2]!.signal!;
    polls.push({ status, requests: [envelope('new')], cancelled: ['old'] });
    await vi.advanceTimersByTimeAsync(350);
    expect(signal.aborted).toBe(true);
    expect(captured.execute).toHaveBeenCalledTimes(1);
    held.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.execute).toHaveBeenCalledTimes(2);
    expect(calls.filter((c) => c.action === 'complete').map((c) => c.body.id)).toEqual([
      'old',
      'new',
    ]);
  });

  it('remembers cancellation of work waiting behind a previous async request', async () => {
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    polls.push({ status, requests: [envelope('old')], cancelled: [] });
    await start();
    polls.push({ status, requests: [envelope('new')], cancelled: ['old'] });
    await vi.advanceTimersByTimeAsync(350);
    polls.push({ status, requests: [], cancelled: ['new'] });
    await vi.advanceTimersByTimeAsync(350);
    held.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.execute.mock.calls[1]![2]!.signal!.aborted).toBe(true);
  });

  it('local revoke aborts both delivered and queued work before the native round trip', async () => {
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    polls.push({ status, requests: [envelope('old')], cancelled: [] });
    await start();
    polls.push({ status, requests: [envelope('new')], cancelled: ['old'] });
    await vi.advanceTimersByTimeAsync(350);
    window.dispatchEvent(new CustomEvent(REMOTE_REVOKE_EVENT, { detail: { clientId: 'client' } }));
    held.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
    expect(captured.execute.mock.calls.every((call) => call[2]!.signal!.aborted)).toBe(true);
  });

  it('checks the current client grant and wires the actual prepared review owner', async () => {
    let permission: boolean | undefined;
    captured.execute.mockImplementationOnce(async () => {
      permission = captured.options!.canWrite();
      return result;
    });
    polls.push({ status, requests: [envelope('read-only', false)], cancelled: [] });
    await start();
    expect(permission).toBe(false);
    expect(captured.options!.getReview).toBe(preparedJobReview);
    expect(captured.options!.canShareArtwork?.()).toBe(false);
    expect(captured.options!.canWrite()).toBe(false);
  });

  it('an old cleanup sends its own session and cannot clear a successor session', async () => {
    const old = await start();
    await start();
    old.stop();
    await useRemoteAccessStore.getState().act('pair');
    expect(calls.findLast((call) => call.action === 'detach')!.body.sessionId).toBe('session-1');
    expect(calls.findLast((call) => call.action === 'pair')!.body.sessionId).toBe('session-2');
  });

  it('a broken native poll cancels work and publishes offline instead of stale connected status', async () => {
    const held = deferred();
    captured.execute.mockImplementationOnce(async () => held.promise);
    polls.push({ status, requests: [envelope('old')], cancelled: [] });
    await start();
    polls.push({ invalid: true });
    await vi.advanceTimersByTimeAsync(350);
    expect(captured.execute.mock.calls[0]![2]!.signal!.aborted).toBe(true);
    expect(useRemoteAccessStore.getState().status).toMatchObject({ connected: false, clients: [] });
    expect(useRemoteAccessStore.getState().message).toContain('Reopen the app');
    held.resolve(result);
    await vi.advanceTimersByTimeAsync(0);
  });

  it('a rejected old poll cannot overwrite a live successor after remount', async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((done) => {
      release = done;
    });
    const fetcher = vi.mocked(fetch);
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(input).endsWith('/poll') && body.sessionId === 'session-1') return held;
      return original(input, init);
    });
    const old = await start();
    await start();
    old.stop();
    expect(useRemoteAccessStore.getState().status?.connected).toBe(true);
    release(Response.json({ error: 'unavailable' }, { status: 409 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteAccessStore.getState().status?.connected).toBe(true);
    expect(useRemoteAccessStore.getState().message).toBeNull();
  });

  it('a delayed pre-Create poll cannot restore a superseded pairing code', async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((done) => {
      release = done;
    });
    const old = {
      ...status,
      statusRevision: 1,
      pairing: { code: 'OldCode12345A', expiresAt: Date.now() + 300_000, expiresInMs: 300_000 },
    };
    const current = { ...status, statusRevision: 2, pairingPending: true };
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/poll')) return held;
      if (String(input).endsWith('/pair')) return Response.json(current);
      return original(input, init);
    });
    await start();
    await useRemoteAccessStore.getState().act('pair');
    expect(useRemoteAccessStore.getState().status?.pairing).toBeNull();
    release(Response.json({ requests: [], cancelled: [], status: old }));
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteAccessStore.getState().status?.pairing).toBeNull();
    expect(useRemoteAccessStore.getState().status?.pairingPending).toBe(true);
  });

  it('a delayed action from an old session cannot replace its successor status or busy owner', async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((done) => {
      release = done;
    });
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(input).endsWith('/pair') && body.sessionId === 'session-1') return held;
      return original(input, init);
    });
    const old = await start();
    const action = useRemoteAccessStore.getState().act('pair');
    await start();
    old.stop();
    release(
      Response.json({
        ...status,
        statusRevision: 999,
        connected: false,
        pairing: { code: 'OldCode12345A', expiresAt: Date.now() + 300_000, expiresInMs: 300_000 },
      }),
    );
    await action;
    expect(useRemoteAccessStore.getState().status).toMatchObject({
      connected: true,
      pairing: null,
    });
    expect(useRemoteAccessStore.getState().message).toBeNull();
  });

  it('an old action failure cannot clear a successor action busy flag or overwrite its message', async () => {
    let releaseOld!: (response: Response) => void;
    let releaseNew!: (response: Response) => void;
    const heldOld = new Promise<Response>((done) => {
      releaseOld = done;
    });
    const heldNew = new Promise<Response>((done) => {
      releaseNew = done;
    });
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(input).endsWith('/pair'))
        return body.sessionId === 'session-1' ? heldOld : heldNew;
      return original(input, init);
    });
    const old = await start();
    const oldAction = useRemoteAccessStore.getState().act('pair');
    await start();
    old.stop();
    const newAction = useRemoteAccessStore.getState().act('pair');
    useRemoteAccessStore.getState().setMessage('Current workspace is waiting for its code.');
    releaseOld(Response.json({ error: 'unavailable' }, { status: 503 }));
    await oldAction;
    expect(useRemoteAccessStore.getState()).toMatchObject({
      busy: true,
      message: 'Current workspace is waiting for its code.',
    });
    releaseNew(Response.json({ ...status, statusRevision: 2, pairingPending: true }));
    await newAction;
    expect(useRemoteAccessStore.getState().busy).toBe(false);
  });

  it('clears a previous code immediately and fences pre-Create polls while the action response is held', async () => {
    let releaseAction!: (response: Response) => void;
    let releasePoll!: (response: Response) => void;
    const heldAction = new Promise<Response>((done) => {
      releaseAction = done;
    });
    const heldPoll = new Promise<Response>((done) => {
      releasePoll = done;
    });
    await start();
    const old = {
      ...status,
      statusRevision: 2,
      pairing: { code: 'OldCode12345A', expiresAt: Date.now() + 300_000, expiresInMs: 300_000 },
    };
    useRemoteAccessStore.getState().publish(old);
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/pair')) return heldAction;
      if (String(input).endsWith('/poll')) return heldPoll;
      return original(input, init);
    });
    await vi.advanceTimersByTimeAsync(350);
    const action = useRemoteAccessStore.getState().act('pair');
    expect(useRemoteAccessStore.getState().status?.pairing).toBeNull();
    releasePoll(
      Response.json({ requests: [], cancelled: [], status: { ...old, statusRevision: 3 } }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteAccessStore.getState().status?.pairing).toBeNull();
    releaseAction(Response.json({ ...status, statusRevision: 4, pairingPending: true }));
    await action;
    expect(useRemoteAccessStore.getState().status?.pairingPending).toBe(true);
  });

  it('subtracts native route elapsed time so a delayed latest snapshot cannot revive an expired code', async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((done) => {
      release = done;
    });
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) =>
      String(input).endsWith('/poll') ? held : original(input, init),
    );
    await start();
    await vi.advanceTimersByTimeAsync(1_000);
    release(
      Response.json({
        requests: [],
        cancelled: [],
        status: {
          ...status,
          pairing: { code: 'OldCode12345A', expiresAt: Date.now() + 300_000, expiresInMs: 1_000 },
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteAccessStore.getState().status?.pairing).toBeNull();
  });

  it('a same-owner native poll failure fences an already in-flight action response and finally', async () => {
    let release!: (response: Response) => void;
    const held = new Promise<Response>((done) => {
      release = done;
    });
    await start();
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/pair')) return held;
      if (String(input).endsWith('/poll')) return Response.json({ invalid: true });
      return original(input, init);
    });
    const action = useRemoteAccessStore.getState().act('pair');
    await vi.advanceTimersByTimeAsync(350);
    expect(useRemoteAccessStore.getState()).toMatchObject({
      busy: false,
      status: { connected: false, pairing: null, pairingPending: false },
    });
    release(
      Response.json({
        ...status,
        statusRevision: 999,
        pairing: { code: 'OldCode12345A', expiresAt: Date.now() + 300_000, expiresInMs: 300_000 },
      }),
    );
    await action;
    expect(useRemoteAccessStore.getState()).toMatchObject({
      busy: false,
      status: { connected: false, pairing: null, pairingPending: false },
    });
    expect(useRemoteAccessStore.getState().message).toContain('Reopen the app');
  });
});
