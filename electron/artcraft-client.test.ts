// @vitest-environment node
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { artcraftRequest } from './artcraft-client';

const servers: Server[] = [];
const sockets = new Set<Socket>();
type Request = { id: string; method: string; params: Record<string, unknown> };
async function endpoint(handle: (request: Request, socket: Socket) => void) {
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let pending = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      pending += chunk;
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        handle(JSON.parse(line) as Request, socket);
      }
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return { port: address.port, timeoutMs: 1_000 };
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe('ArtCraft native control transport', () => {
  it('authenticates PhotoCraft before sending the command and handles split UTF-8 replies', async () => {
    const methods: string[] = [];
    const target = await endpoint((request, socket) => {
      methods.push(request.method);
      if (request.method === 'auth') {
        expect(request.params).toEqual({ token: 'private-test-token' });
        socket.write(JSON.stringify({ id: request.id, ok: true, result: null }) + '\n');
        return;
      }
      const response = Buffer.from(
        JSON.stringify({ id: request.id, ok: true, result: 'café' }) + '\n',
      );
      const split = response.indexOf(Buffer.from('é')) + 1;
      socket.write(response.subarray(0, split));
      setTimeout(() => socket.end(response.subarray(split)), 5);
    });
    await expect(
      artcraftRequest({ ...target, token: 'private-test-token' }, 'ui.inspect'),
    ).resolves.toBe('café');
    expect(methods).toEqual(['auth', 'ui.inspect']);
  });

  it('sends VectorCraft requests without an authentication prelude', async () => {
    const target = await endpoint((request, socket) => {
      expect(request.method).toBe('document.inspect');
      expect(request.params).toEqual({ depth: 0 });
      socket.end(JSON.stringify({ id: request.id, ok: true, result: { revision: 4 } }) + '\n');
    });
    await expect(artcraftRequest(target, 'document.inspect', { depth: 0 })).resolves.toEqual({
      revision: 4,
    });
  });

  it('never sends the requested edit when authentication fails', async () => {
    const methods: string[] = [];
    const target = await endpoint((request, socket) => {
      methods.push(request.method);
      socket.end(
        JSON.stringify({ id: request.id, ok: false, error: 'bad token private-test-token' }) + '\n',
      );
    });
    await expect(
      artcraftRequest({ ...target, token: 'private-test-token' }, 'app.save'),
    ).rejects.toThrow('ArtCraft authentication failed');
    expect(methods).toEqual(['auth']);
  });

  it('rejects a reply for a different request instead of consuming its result', async () => {
    const target = await endpoint((_request, socket) => {
      socket.end(JSON.stringify({ id: 'someone-else', ok: true, result: 'wrong' }) + '\n');
    });
    await expect(artcraftRequest(target, 'ui.inspect')).rejects.toThrow('unexpected control reply');
  });

  it('surfaces an editor refusal', async () => {
    const target = await endpoint((request, socket) => {
      socket.end(JSON.stringify({ id: request.id, ok: false, error: 'no document open' }) + '\n');
    });
    await expect(artcraftRequest(target, 'app.save')).rejects.toThrow('ArtCraft: no document open');
  });

  it('rejects malformed JSON and oversized unterminated replies', async () => {
    const malformed = await endpoint((_request, socket) => socket.end('not-json\n'));
    await expect(artcraftRequest(malformed, 'ui.inspect')).rejects.toThrow('invalid JSON');
    const oversized = await endpoint((_request, socket) =>
      socket.end(Buffer.alloc(8 * 1024 * 1024 + 1, 32)),
    );
    await expect(artcraftRequest(oversized, 'ui.inspect')).rejects.toThrow('size limit');
  });

  it('times out an incomplete response without replaying the edit', async () => {
    let requests = 0;
    const target = await endpoint((_request, socket) => {
      requests++;
      socket.write('{');
    });
    await expect(artcraftRequest({ ...target, timeoutMs: 30 }, 'app.save')).rejects.toThrow(
      'may have completed',
    );
    expect(requests).toBe(1);
  });

  it('rejects early disconnects without replaying the edit', async () => {
    let requests = 0;
    const target = await endpoint((_request, socket) => {
      requests++;
      socket.destroy();
    });
    await expect(artcraftRequest(target, 'app.save')).rejects.toThrow('closed before replying');
    expect(requests).toBe(1);
  });
});
