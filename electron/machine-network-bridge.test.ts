// @vitest-environment node
import { createServer, type Server, type Socket } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { MachineNetworkBridge, validateNetworkTarget } from './machine-network-bridge';

const bridges: MachineNetworkBridge[] = [];
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const bridge of bridges.splice(0)) bridge.dispose();
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function fixture(onConnection: (socket: Socket) => void) {
  const server = createServer((socket) => {
    sockets.push(socket);
    onConnection(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing loopback fixture port');
  const bridge = new MachineNetworkBridge();
  bridges.push(bridge);
  const opened = await bridge.open('127.0.0.1', address.port);
  return { bridge, id: opened.sessionId, port: address.port };
}

it('moves real loopback TCP bytes through the bounded channel and rejects replay', async () => {
  const received: Buffer[] = [];
  const { bridge, id } = await fixture((socket) => {
    socket.on('data', (chunk: Buffer) => {
      received.push(chunk);
      if (chunk.includes(0x85)) socket.write('ok\r\n');
    });
    socket.write(Buffer.concat([Buffer.from([255, 251, 1]), Buffer.from('Grbl 1.1f FluidNC\r\n')]));
  });
  expect(Buffer.from((await bridge.read(id)).data, 'base64').toString()).toContain(
    'Grbl 1.1f FluidNC',
  );
  await bridge.write(id, 1, Buffer.from([0x85]).toString('base64'));
  expect(Buffer.from((await bridge.read(id)).data, 'base64').toString()).toBe('ok\r\n');
  expect([...Buffer.concat(received)]).toContain(0x85);
  expect([...Buffer.concat(received)]).not.toContain(0xc2);
  await expect(bridge.write(id, 1, Buffer.from('G1 X1\n').toString('base64'))).rejects.toThrow(
    'sequence',
  );
  expect((await bridge.read(id)).closed).toBe(true);
});

it('allows one explicit connection, closes on socket loss, and reconnects only by a new open', async () => {
  let count = 0;
  const { bridge, id, port } = await fixture((socket) => {
    count += 1;
    socket.write('ready\n');
  });
  await expect(bridge.open('127.0.0.1', port)).rejects.toThrow('Disconnect');
  await bridge.read(id);
  sockets[0]?.destroy();
  expect((await bridge.read(id)).closed).toBe(true);
  expect(count).toBe(1);
  bridge.close(id);
  const next = await bridge.open('127.0.0.1', port);
  expect(next.sessionId).not.toBe(id);
  expect(count).toBe(2);
});

it('refuses malformed targets and oversized/empty payloads without emitting G-code', async () => {
  for (const host of ['http://127.0.0.1', 'host/path', 'user@host', '', ' host'])
    expect(() => validateNetworkTarget(host, 23)).toThrow();
  expect(() => validateNetworkTarget('127.0.0.1', 0)).toThrow();
  const received: Buffer[] = [];
  const { bridge, id } = await fixture((socket) =>
    socket.on('data', (chunk: Buffer) => received.push(chunk)),
  );
  await expect(bridge.write(id, 1, '')).rejects.toThrow('payload');
  await expect(bridge.write(id, 1, Buffer.alloc(65537).toString('base64'))).rejects.toThrow(
    'payload',
  );
  expect(received).toEqual([]);
});

it('closes an overfull receive queue instead of dropping acknowledgements into a live session', async () => {
  const { bridge, id } = await fixture((socket) => {
    socket.write(Buffer.alloc(513 * 1024, 65));
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const result = await bridge.read(id);
  expect(result.closed).toBe(true);
  expect(result.error).toContain('limit');
  expect(result.data).toBe('');
});
