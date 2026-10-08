// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemoteRendererQueue } from './renderer-queue.js';
import { createRemoteRelayClient } from './relay-client.js';
import { REMOTE_ORIGIN } from './relay-types.js';
import { MCP_MAX_RESULT_BYTES } from '../mcp/input-schemas.js';

const captured = vi.hoisted(() => {
  const sockets: FakeSocket[] = [];
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    readonly sent: Record<string, unknown>[] = [];
    readonly frames: string[] = [];
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
      this.frames.push(value);
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
let connection: ReturnType<typeof vi.fn<(connected: boolean) => void>>;
beforeEach(() => {
  captured.sockets.length = 0;
  permitted = true;
  fetcher = vi.fn(async () => Response.json({ registered: true }));
  vi.stubGlobal('fetch', fetcher);
  queue = createRemoteRendererQueue();
  session = queue.attach();
  connection = vi.fn<(connected: boolean) => void>();
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
const command = (requestId: string = randomUUID()) => ({
  type: 'command',
  requestId,
  clientId: 'client',
  scopes: ['read'],
  command: { name: 'get_app_status', args: {} },
});

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function materialResult(dataBytes: number) {
  const recipes = Array.from({ length: 200 }, (_, i) => ({
    id: `recipe-${i}`,
    name: 'N',
    materialName: 'M',
    powerPercent: 30,
    speedMmPerMin: 1500,
    passes: 1,
  }));
  const result = { revision: 'r1', recipes, total: 200, truncated: false };
  let remaining = dataBytes - jsonBytes(result);
  for (const recipe of recipes) {
    for (const key of ['name', 'materialName'] as const) {
      const added = Math.min(1535, remaining);
      const size = added + 1;
      recipe[key] = '材'.repeat(Math.floor(size / 3)) + ['', 'A', 'é'][size % 3];
      remaining -= added;
    }
  }
  expect(remaining).toBe(0);
  expect(jsonBytes(result)).toBe(dataBytes);
  return result;
}
const recipesCommand = (requestId: string) => ({
  ...command(requestId),
  command: { name: 'list_material_recipes', args: {} },
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

  it('never upgrades edit to control and carries an exact separately approved control envelope', async () => {
    const socket = await connect();
    const jogArgs = {
      expectedRevision: 'r1',
      requestId: randomUUID(),
      axis: 'x',
      direction: 1,
      distanceMm: 1,
    };
    socket.receive({
      ...command(),
      scopes: ['read', 'edit'],
      command: { name: 'jog_machine', args: jogArgs },
    });
    await flush();
    expect(queue.poll(session).requests).toEqual([]);
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: 'error',
        error: expect.objectContaining({ code: 'invalid_input' }),
      }),
    );
    socket.receive({
      ...command(),
      scopes: ['read', 'control'],
      command: { name: 'jog_machine', args: jogArgs },
    });
    await flush();
    const delivered = queue.poll(session).requests[0]!;
    expect(delivered).toMatchObject({ command: 'jog_machine', canWrite: false, canControl: true });
    queue.complete(session, delivered.id, {
      revision: 'r1',
      operation: {
        operationId: jogArgs.requestId,
        revision: 'r1',
        kind: 'jog',
        state: 'accepted',
        committed: false,
      },
    });
    await flush();
    expect(socket.sent).toContainEqual(
      expect.objectContaining({
        type: 'result',
        result: expect.objectContaining({
          operation: expect.objectContaining({ state: 'accepted' }),
        }),
      }),
    );
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

  it.each(['8'.repeat(36), '界'.repeat(128), '🛠'.repeat(64)])(
    'holds the complete UTF-8 result envelope at its exact byte ceiling for %s',
    async (requestId: string) => {
      const socket = await connect();
      const overhead = jsonBytes({ v: 1, type: 'result', requestId, result: null }) - 4;
      const response = materialResult(MCP_MAX_RESULT_BYTES - overhead);
      socket.receive(recipesCommand(requestId));
      const request = queue.poll(session).requests[0]!;
      queue.complete(session, request.id, response);
      await flush();
      expect(socket.sent).toEqual([{ v: 1, type: 'result', requestId, result: response }]);
      expect(Buffer.byteLength(socket.frames[0]!, 'utf8')).toBe(MCP_MAX_RESULT_BYTES);
      expect(socket.sent[0]!.result).toEqual(response);
    },
  );

  it.each([1, 84])(
    'returns a fixed bounded error for a result envelope %i bytes too large and stays usable',
    async (excess: number) => {
      const socket = await connect();
      const requestId = '8'.repeat(36);
      const overhead = jsonBytes({ v: 1, type: 'result', requestId, result: null }) - 4;
      const response = materialResult(MCP_MAX_RESULT_BYTES - overhead + excess);
      socket.receive(recipesCommand(requestId));
      queue.complete(session, queue.poll(session).requests[0]!.id, response);
      await flush();
      expect(socket.sent).toEqual([
        {
          v: 1,
          type: 'error',
          requestId,
          error: { code: 'failed', message: 'The desktop request could not be completed.' },
        },
      ]);
      expect(Buffer.byteLength(socket.frames[0]!, 'utf8')).toBeLessThan(MCP_MAX_RESULT_BYTES);
      expect(socket.readyState).toBe(1);
      expect(connection).toHaveBeenLastCalledWith(true);
      const next = command();
      socket.receive(next);
      queue.complete(session, queue.poll(session).requests[0]!.id, output);
      await flush();
      expect(socket.sent[1]).toEqual({
        v: 1,
        type: 'result',
        requestId: next.requestId,
        result: output,
      });
    },
  );

  it('counts serialized Unicode and escaped identifier overhead instead of character length', async () => {
    const socket = await connect();
    const requestId = '界'.repeat(123) + '"\\\n';
    const response = materialResult(MCP_MAX_RESULT_BYTES - 84);
    const frame = { v: 1, type: 'result', requestId, result: response };
    expect(JSON.stringify(frame).length).toBeLessThan(MCP_MAX_RESULT_BYTES);
    expect(jsonBytes(frame)).toBeGreaterThan(MCP_MAX_RESULT_BYTES);
    socket.receive(recipesCommand(requestId));
    queue.complete(session, queue.poll(session).requests[0]!.id, response);
    await flush();
    expect(socket.sent[0]).toMatchObject({ type: 'error', requestId, error: { code: 'failed' } });
    expect(
      socket.frames.every((value) => Buffer.byteLength(value, 'utf8') <= MCP_MAX_RESULT_BYTES),
    ).toBe(true);
  });

  it('suppresses a fixed result error after the client permission is revoked', async () => {
    const socket = await connect();
    socket.receive(recipesCommand('8'.repeat(36)));
    const request = queue.poll(session).requests[0]!;
    permitted = false;
    queue.complete(session, request.id, { revision: 'r1', recipes: 'private renderer detail' });
    await flush();
    expect(socket.sent).toEqual([]);
  });

  it('retains read receipts for a read/control token after only its local control deadline expires', async () => {
    relay = createRemoteRelayClient({
      queue,
      onMessage: vi.fn(),
      onConnection: connection,
      canRequest: (_clientId, _scopes, requiresControl) => requiresControl !== true,
    });
    const socket = await connect();
    const reading = { ...command(), scopes: ['read', 'control'] };
    socket.receive(reading);
    const delivered = queue.poll(session).requests[0]!;
    expect(delivered).toMatchObject({ command: 'get_app_status', canControl: false });
    queue.complete(session, delivered.id, output);
    await flush();
    expect(socket.sent).toContainEqual({
      v: 1,
      type: 'result',
      requestId: reading.requestId,
      result: output,
    });
    socket.receive({
      ...command(),
      scopes: ['read', 'control'],
      command: { name: 'abort_job', args: { requestId: randomUUID() } },
    });
    expect(queue.poll(session).requests).toEqual([]);
    expect(socket.sent).toContainEqual(expect.objectContaining({ type: 'error' }));
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
