import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteRendererSession } from './renderer-session';
import { setRemoteSession, useRemoteAccessStore } from './remote-access-store';
import { pairingFixture as status } from './pairing-test-support';

vi.mock('../remote-control/adapter', () => ({
  createRemoteControlAdapter: () => ({
    execute: vi.fn(),
    dispose: vi.fn(),
    getRevision: () => 'r1',
  }),
}));

let calls: { action: string; body: Record<string, unknown> }[];
let sessions: RemoteRendererSession[];
let attachNumber: number;
beforeEach(() => {
  vi.useFakeTimers();
  setRemoteSession(null);
  useRemoteAccessStore.setState({
    status: null,
    connectionLost: false,
    message: null,
    busy: false,
  });
  calls = [];
  sessions = [];
  attachNumber = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split('/').at(-1)!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ action, body });
      if (action === 'attach') return Response.json({ sessionId: 'session-' + ++attachNumber });
      if (action === 'poll') return Response.json({ requests: [], cancelled: [], status });
      return Response.json(status);
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

describe('renderer attach ownership', () => {
  it('stopping an old pending attach preserves its successor attempt', async () => {
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (response: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(
        new Promise<Response>((_resolve, reject) => {
          rejectOld = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          resolveNew = resolve;
        }),
      );
    const old = new RemoteRendererSession();
    const next = new RemoteRendererSession();
    sessions.push(old, next);
    const oldStart = old.start();
    const nextStart = next.start();
    old.stop();
    rejectOld(new Error('old attach stopped'));
    await oldStart;
    expect(useRemoteAccessStore.getState()).toMatchObject({ connectionLost: false, message: null });
    resolveNew(Response.json({ sessionId: 'successor' }));
    await nextStart;
    await vi.advanceTimersByTimeAsync(0);
    expect(useRemoteAccessStore.getState().status?.connected).toBe(true);
    await useRemoteAccessStore.getState().act('pair');
    expect(calls.findLast((call) => call.action === 'pair')?.body.sessionId).toBe('successor');
  });

  it.each(['rejected', 'invalid'] as const)(
    'reports an initial %s attach as terminal and permits a new owner',
    async (failure) => {
      if (failure === 'rejected') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
      else vi.mocked(fetch).mockResolvedValueOnce(Response.json({ invalid: true }));
      await start();
      expect(useRemoteAccessStore.getState()).toMatchObject({
        status: null,
        connectionLost: true,
        message: expect.stringContaining('Reopen the app'),
      });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(calls.filter((call) => call.action === 'poll')).toHaveLength(0);
      await start();
      expect(useRemoteAccessStore.getState()).toMatchObject({
        status: { connected: true },
        connectionLost: false,
        message: null,
      });
    },
  );

  it('ignores a failed attach after that renderer stops', async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((_resolve, fail) => {
        reject = fail;
      }),
    );
    const old = new RemoteRendererSession();
    sessions.push(old);
    const starting = old.start();
    old.stop();
    reject(new Error('offline'));
    await starting;
    expect(useRemoteAccessStore.getState()).toMatchObject({
      status: null,
      connectionLost: false,
      message: null,
    });
  });

  it.each(['pending', 'connected'] as const)(
    'ignores an old attach failure while its successor is %s',
    async (successor) => {
      let rejectOld!: (reason: Error) => void;
      let resolveNew!: (response: Response) => void;
      vi.mocked(fetch)
        .mockReturnValueOnce(
          new Promise<Response>((_resolve, reject) => {
            rejectOld = reject;
          }),
        )
        .mockReturnValueOnce(
          new Promise<Response>((resolve) => {
            resolveNew = resolve;
          }),
        );
      const old = new RemoteRendererSession();
      const next = new RemoteRendererSession();
      sessions.push(old, next);
      const oldStart = old.start();
      const nextStart = next.start();
      if (successor === 'connected') {
        resolveNew(Response.json({ sessionId: 'successor' }));
        await nextStart;
        await vi.advanceTimersByTimeAsync(0);
      }
      rejectOld(new Error('old attach failed'));
      await oldStart;
      expect(useRemoteAccessStore.getState()).toMatchObject({
        connectionLost: false,
        message: null,
      });
      if (successor === 'pending') {
        resolveNew(Response.json({ sessionId: 'successor' }));
        await nextStart;
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(useRemoteAccessStore.getState().status?.connected).toBe(true);
    },
  );

  it('detaches a stale successful attach without replacing its live successor', async () => {
    let resolveOld!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const old = new RemoteRendererSession();
    sessions.push(old);
    const oldStart = old.start();
    await start();
    resolveOld(Response.json({ sessionId: 'stale-attach' }));
    await oldStart;
    await useRemoteAccessStore.getState().act('pair');
    expect(calls.findLast((call) => call.action === 'detach')?.body.sessionId).toBe('stale-attach');
    expect(calls.findLast((call) => call.action === 'pair')?.body.sessionId).toBe('session-1');
    expect(useRemoteAccessStore.getState().status?.connected).toBe(true);
  });
});
