// @vitest-environment node
// The worker that streams a desktop network session (ADR-676), against a fake
// of the main process's routes: `read` long-polls, `write` must arrive in
// sequence, `close` ends the session (electron/machine-network-session.ts).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { encodeProgramLines } from './serial-program-buffer';
import { createNetworkSerialWorkerRuntime } from './network-serial-worker-runtime';
import type { NetworkSerialWorkerResponse } from './network-serial-worker-protocol';

const ROUTE = { url: 'app://app/api/machine-network/', header: 'X-KerfDesk-Machine-Network' };
const SESSION = '00000000-0000-4000-8000-000000000001';

type FakeSession = {
  readonly fetch: typeof fetch;
  readonly writes: Array<{ readonly sequence: number; readonly text: string }>;
  readonly actions: string[];
  /** Bytes the controller sends to the host. */
  readonly emit: (text: string) => void;
  readonly end: () => void;
  failReads: boolean;
  failWrites: boolean;
};

const sessions: FakeSession[] = [];

function fakeSession(): FakeSession {
  let inbound = '';
  let closed = false;
  let waiter: (() => void) | null = null;
  const session: FakeSession = {
    writes: [],
    actions: [],
    failReads: false,
    failWrites: false,
    emit: (text) => {
      inbound += text;
      waiter?.();
    },
    end: () => {
      closed = true;
      waiter?.();
    },
    fetch: async (input, init) => {
      const action = String(input).slice(ROUTE.url.length);
      session.actions.push(action);
      const headers = new Headers(init?.headers);
      if (headers.get(ROUTE.header) !== '1') return Response.json({ error: 'no' }, { status: 404 });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (body['sessionId'] !== SESSION)
        return Response.json({ error: 'session' }, { status: 400 });
      if (action === 'read') {
        if (session.failReads) throw new TypeError('Failed to fetch');
        if (inbound === '' && !closed) {
          await new Promise<void>((resolve) => {
            waiter = resolve;
            setTimeout(resolve, 20);
          });
          waiter = null;
        }
        const data = btoa(inbound);
        inbound = '';
        return Response.json({ data, closed });
      }
      if (action === 'write') {
        const sequence = body['sequence'] as number;
        if (session.failWrites) throw new TypeError('Failed to fetch');
        session.writes.push({ sequence, text: atob(String(body['data'])) });
        return Response.json({ written: true });
      }
      closed = true;
      return Response.json({ closed: true });
    },
  };
  sessions.push(session);
  return session;
}

function runtimeOn(session: FakeSession) {
  const posted: NetworkSerialWorkerResponse[] = [];
  const runtime = createNetworkSerialWorkerRuntime({
    post: (message) => posted.push(message),
    fetch: session.fetch,
  });
  return { runtime, posted };
}

async function until(condition: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function lines(posted: ReadonlyArray<NetworkSerialWorkerResponse>): ReadonlyArray<string> {
  return posted.flatMap((message) => (message.kind === 'line' ? [message.line] : []));
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.end();
});

describe('network serial worker runtime (ADR-676)', () => {
  it('takes the session only after its own first read succeeds', async () => {
    const session = fakeSession();
    session.emit("Grbl 1.1h ['$' for help]\r\n");
    const { runtime, posted } = runtimeOn(session);

    runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
    await until(() => posted.some((m) => m.kind === 'network-ready'));
    // Nothing reaches the window before it asks for the lines.
    expect(lines(posted)).toEqual([]);

    runtime.handle({ kind: 'network-start' });
    await until(() => lines(posted).length === 1);
    expect(lines(posted)).toEqual(["Grbl 1.1h ['$' for help]"]);
    await runtime.close();
  });

  it('leaves the session to the window when its first read fails', async () => {
    const session = fakeSession();
    session.failReads = true;
    const { runtime, posted } = runtimeOn(session);

    runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
    await until(() => posted.length > 0);

    expect(posted[0]).toMatchObject({ kind: 'network-unavailable', id: 1 });
    expect(session.writes).toEqual([]);
    expect(session.actions).not.toContain('close');
  });

  it('writes in sequence and refills an armed stream on each ok by itself', async () => {
    const session = fakeSession();
    const { runtime, posted } = runtimeOn(session);
    runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
    await until(() => posted.some((m) => m.kind === 'network-ready'));
    runtime.handle({ kind: 'network-start' });

    // A FluidNC-style ping-pong stream whose first line is on the wire.
    const first = step(
      createStreamer('M3 S0\nG1 X1 S800\nG1 X2\nM5\n', { streamingMode: 'ping-pong' }),
    );
    runtime.handle({ kind: 'write', id: 1, data: first.toSend });
    const { queued, ...position } = first.state;
    runtime.handle({ kind: 'program', programId: 1, ...encodeProgramLines(queued) });
    runtime.handle({ kind: 'prepare-arm', id: 2 });
    runtime.handle({ kind: 'arm', id: 2, programId: 1, position });
    await until(() => posted.some((m) => m.kind === 'armed'));

    for (let ack = 0; ack < 3; ack += 1) {
      session.emit('ok\r\n');
      await until(() => session.writes.length === ack + 2);
    }

    expect(session.writes).toEqual([
      { sequence: 1, text: 'M3 S0\n' },
      { sequence: 2, text: 'G1 X1 S800\n' },
      { sequence: 3, text: 'G1 X2\n' },
      { sequence: 4, text: 'M5\n' },
    ]);
    expect(lines(posted)).toEqual(['ok', 'ok', 'ok']);
    await runtime.close();
  });

  it('reports closed once the main process ends the session', async () => {
    const session = fakeSession();
    const { runtime, posted } = runtimeOn(session);
    runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
    await until(() => posted.some((m) => m.kind === 'network-ready'));
    runtime.handle({ kind: 'network-start' });

    session.emit('ALARM:1\r\n');
    session.end();
    await until(() => posted.some((m) => m.kind === 'closed'));

    // The closing read still carried the controller's last line.
    expect(lines(posted)).toEqual(['ALARM:1']);
  });

  // Rolling audit v9 R1-P2-2 (ADR-398 Amendment 7). The request failed on its
  // way to the main process, so the socket may be fine, and closing it stops
  // nothing: the store's stop goes out first.
  describe('a request that fails while the session may still take writes', () => {
    async function started(session: FakeSession) {
      const opened = runtimeOn(session);
      opened.runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
      await until(() => opened.posted.some((m) => m.kind === 'network-ready'));
      opened.runtime.handle({ kind: 'network-start' });
      return opened;
    }

    it('keeps the session open for the stop after a failed read, then closes it', async () => {
      const session = fakeSession();
      const { runtime, posted } = await started(session);

      session.failReads = true;
      await until(() => posted.some((m) => m.kind === 'read-failing'));
      expect(posted.some((m) => m.kind === 'closed')).toBe(false);
      expect(session.actions).not.toContain('close');

      runtime.handle({ kind: 'write', id: 1, data: '\x18' });
      await until(() => posted.some((m) => m.kind === 'write-ack'));
      expect(session.writes).toEqual([{ sequence: 1, text: '\x18' }]);

      runtime.handle({ kind: 'read-failure-settled' });
      await until(() => posted.some((m) => m.kind === 'closed'));
      expect(session.actions.at(-1)).toBe('close');
    });

    it('stops waiting when the session is closed meanwhile', async () => {
      const session = fakeSession();
      const { runtime, posted } = await started(session);
      session.failReads = true;
      await until(() => posted.some((m) => m.kind === 'read-failing'));

      runtime.handle({ kind: 'close' });

      await until(() => posted.some((m) => m.kind === 'closed'));
      expect(posted.filter((m) => m.kind === 'closed')).toHaveLength(1);
    });

    it('closes after 3 s when the stop never settles', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        const session = fakeSession();
        const { runtime, posted } = runtimeOn(session);
        runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
        await vi.advanceTimersByTimeAsync(50);
        runtime.handle({ kind: 'network-start' });
        session.failReads = true;
        await vi.advanceTimersByTimeAsync(50);
        expect(posted.some((m) => m.kind === 'read-failing')).toBe(true);

        await vi.advanceTimersByTimeAsync(2_900);
        expect(posted.some((m) => m.kind === 'closed')).toBe(false);
        await vi.advanceTimersByTimeAsync(200);
        expect(posted.some((m) => m.kind === 'closed')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still closes at once when the main process reports its socket gone', async () => {
      const session = fakeSession();
      const { posted } = await started(session);

      session.end();
      await until(() => posted.some((m) => m.kind === 'closed'));

      expect(posted.some((m) => m.kind === 'read-failing')).toBe(false);
    });

    it('stays open after a failed write, numbering the stop after it', async () => {
      const session = fakeSession();
      const { runtime, posted } = await started(session);
      const first = step(createStreamer('G1 X1\nG1 X2\nG1 X3\n', { streamingMode: 'ping-pong' }));
      runtime.handle({ kind: 'write', id: 1, data: first.toSend });
      await until(() => session.writes.length === 1);
      const { queued, ...position } = first.state;
      runtime.handle({ kind: 'program', programId: 1, ...encodeProgramLines(queued) });
      runtime.handle({ kind: 'prepare-arm', id: 2 });
      runtime.handle({ kind: 'arm', id: 2, programId: 1, position });
      await until(() => posted.some((m) => m.kind === 'armed'));

      session.failWrites = true;
      session.emit('ok\r\n');
      await until(() => posted.some((m) => m.kind === 'stream-write-error'));
      session.failWrites = false;

      expect(posted.filter((m) => m.kind === 'stream-write-error')).toHaveLength(1);
      expect(posted.some((m) => m.kind === 'closed')).toBe(false);

      runtime.handle({ kind: 'write', id: 3, data: '\x18' });
      await until(() => session.writes.length === 2);

      // Sequence 2 was the failed refill: never repeated, and nothing after it.
      expect(session.writes).toEqual([
        { sequence: 1, text: 'G1 X1\n' },
        { sequence: 3, text: '\x18' },
      ]);
      expect(session.actions).not.toContain('close');
      await runtime.close();
    });

    it('rejects a write queued behind the failed one, and sends it to nobody', async () => {
      const session = fakeSession();
      const { runtime, posted } = await started(session);

      session.failWrites = true;
      runtime.handle({ kind: 'write', id: 1, data: 'G1 X1\n' });
      runtime.handle({ kind: 'write', id: 2, data: 'G1 X2\n' });
      await until(() => posted.filter((m) => m.kind === 'write-error').length === 2);
      session.failWrites = false;

      runtime.handle({ kind: 'write', id: 3, data: 'M5\n' });
      await until(() => posted.some((m) => m.kind === 'write-ack' && m.id === 3));

      expect(session.writes).toEqual([{ sequence: 2, text: 'M5\n' }]);
      await runtime.close();
    });
  });

  it('closes the session when asked, then says closed', async () => {
    const session = fakeSession();
    const { runtime, posted } = runtimeOn(session);
    runtime.handle({ kind: 'network-attach', id: 1, sessionId: SESSION, route: ROUTE });
    await until(() => posted.some((m) => m.kind === 'network-ready'));
    runtime.handle({ kind: 'network-start' });

    runtime.handle({ kind: 'close' });
    await until(() => posted.some((m) => m.kind === 'closed'));

    expect(session.actions).toContain('close');
  });
});
