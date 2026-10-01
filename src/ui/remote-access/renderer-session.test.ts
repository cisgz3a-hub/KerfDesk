import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteControlOptions, RemoteCommandResult } from '../remote-control/types';
import { RemoteRendererSession } from './renderer-session';
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
  available: true,
  enabled: true,
  connected: true,
  deviceId: 'device',
  controlUrl: 'https://example.test/control?deviceId=device',
  mcpUrl: 'https://example.test/mcp',
  pairing: null,
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

  it('checks the current client grant at execution and does not wire fabricated job review', async () => {
    let permission: boolean | undefined;
    captured.execute.mockImplementationOnce(async () => {
      permission = captured.options!.canWrite();
      return result;
    });
    polls.push({ status, requests: [envelope('read-only', false)], cancelled: [] });
    await start();
    expect(permission).toBe(false);
    expect(captured.options!.getReview).toBeUndefined();
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
});
