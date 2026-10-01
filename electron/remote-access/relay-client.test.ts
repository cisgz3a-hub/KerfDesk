// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteRelayClient } from './relay-client.js';
import { REMOTE_ORIGIN } from './relay-types.js';

const captured = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    readonly sent: Record<string, unknown>[] = [];
    readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    constructor(
      readonly url: URL,
      readonly options: Record<string, unknown>,
    ) {
      sockets.push(this);
    }
    on(name: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
    }
    send(value: string) {
      this.sent.push(JSON.parse(value) as Record<string, unknown>);
    }
    close() {
      this.readyState = 3;
      for (const handler of this.handlers.get('close') ?? []) handler();
    }
    receive(value: Record<string, unknown>, binary = false) {
      const data = Buffer.from(JSON.stringify({ v: 1, ...value }));
      for (const handler of this.handlers.get('message') ?? []) handler(data, binary);
    }
  }
  return { sockets, FakeSocket };
});
vi.mock('ws', () => ({ default: captured.FakeSocket }));

const flush = () => new Promise<void>((done) => setImmediate(done));
const identity = {
  schemaVersion: 1 as const,
  deviceId: randomUUID(),
  ownerSecret: 'A'.repeat(43),
  enabled: true,
  revokeOnConnect: false,
  pendingRevocations: [],
};
const output = {
  revision: 'r1',
  app: { name: 'KerfDesk', version: '1.0.3', platform: 'desktop' },
  edition: { mode: 'free' },
  updates: { available: false },
};
let queue: ReturnType<typeof createRemoteRendererQueue>;
let relay: ReturnType<typeof createRemoteRelayClient>;
let session: string;
let permitted: boolean;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let connection: ReturnType<typeof vi.fn>;
beforeEach(() => {
  captured.sockets.length = 0;
  permitted = true;
  fetcher = vi.fn(async () => Response.json({ registered: true }));
  vi.stubGlobal('fetch', fetcher);
  queue = createRemoteRendererQueue();
  session = queue.attach();
  connection = vi.fn();
  relay = createRemoteRelayClient({
    queue,
    onMessage: vi.fn(),
    onConnection: connection,
    canRequest: () => permitted,
  });
});
afterEach(() => {
  relay.close();
  queue.detach();
  vi.unstubAllGlobals();
});
async function connect() {
  relay.start(identity);
  await flush();
  const socket = captured.sockets.at(-1)!;
  socket.receive({ type: 'connected', deviceId: identity.deviceId });
  return socket;
}
const command = (requestId = randomUUID()) => ({
  type: 'command',
  requestId,
  clientId: 'client',
  scopes: ['read'],
  command: { name: 'get_app_status', args: {} },
});

describe('fixed native relay transport', () => {
  it('registers only at the fixed origin, forbids redirects and keeps owner secrets out of URLs', async () => {
    const socket = await connect();
    expect(fetcher.mock.calls[0]![0]).toBe(`${REMOTE_ORIGIN}/api/desktop/register`);
    const options = fetcher.mock.calls[0]![1]!;
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(String(options.body)).toContain(identity.ownerSecret);
    expect(String(socket.url)).not.toContain(identity.ownerSecret);
    expect(socket.url.searchParams.get('deviceId')).toBe(identity.deviceId);
    expect(socket.url.protocol).toBe('wss:');
    expect(socket.options.headers).toEqual({ Authorization: `Bearer ${identity.ownerSecret}` });
    expect(connection).toHaveBeenLastCalledWith(true);
  });

  it('refuses elevated writes, unknown commands and extra arguments before renderer delivery', async () => {
    const socket = await connect();
    socket.receive({
      ...command(),
      command: {
        name: 'add_rectangle',
        args: {
          expectedRevision: 'r1',
          requestId: randomUUID(),
          xMm: 0,
          yMm: 0,
          widthMm: 1,
          heightMm: 1,
        },
      },
    });
    socket.receive({ ...command(), command: { name: 'run_gcode', args: {} } });
    socket.receive({
      ...command(),
      command: { name: 'get_app_status', args: { nativePath: 'secret' } },
    });
    await flush();
    expect(queue.poll(session).requests).toEqual([]);
    expect(socket.sent).toHaveLength(3);
    expect(socket.sent.every((message) => message.type === 'error')).toBe(true);
    expect(JSON.stringify(socket.sent)).not.toContain('secret');
  });

  it('projects approved results and strips nested credentials before crossing the network', async () => {
    const socket = await connect();
    const message = command();
    socket.receive(message);
    const request = queue.poll(session).requests[0]!;
    queue.complete(session, request.id, {
      ...output,
      app: { ...output.app, nativePath: 'secret' },
      edition: { mode: 'free', licenceKey: 'secret' },
      ownerSecret: 'secret',
    });
    await flush();
    expect(socket.sent).toEqual([
      { v: 1, type: 'result', requestId: message.requestId, result: output },
    ]);
  });

  it('checks permission again before returning a result after revocation', async () => {
    const socket = await connect();
    socket.receive(command());
    const request = queue.poll(session).requests[0]!;
    permitted = false;
    queue.complete(session, request.id, output);
    await flush();
    expect(socket.sent).toEqual([]);
  });

  it('cancels one client and does not let an old connection remove its successor request', async () => {
    const old = await connect();
    const message = command();
    old.receive(message);
    const oldRequest = queue.poll(session).requests[0]!;
    const fresh = await connect();
    fresh.receive(message);
    const next = queue.poll(session);
    expect(next.cancelled).toEqual([oldRequest.id]);
    expect(next.requests).toHaveLength(1);
    await flush();
    relay.cancelClient('client');
    await flush();
    expect(queue.complete(session, next.requests[0]!.id, output)).toBe(false);
    expect(fresh.sent.some((item) => item.type === 'result')).toBe(false);
    expect(old.sent).toEqual([]);
  });

  it('never opens a socket after registration redirects or fails', async () => {
    fetcher.mockRejectedValueOnce(new Error('redirect or network failed'));
    relay.start(identity);
    await flush();
    expect(captured.sockets).toEqual([]);
    expect(connection).toHaveBeenLastCalledWith(false);
  });
});
