// @vitest-environment node
// The worker that streams a desktop network session (ADR-675), against a fake
// of the main process's routes: `read` long-polls, `write` must arrive in
// sequence, `close` ends the session (electron/machine-network-session.ts).

import { afterEach, describe, expect, it } from 'vitest';
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

describe('network serial worker runtime (ADR-675)', () => {
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
