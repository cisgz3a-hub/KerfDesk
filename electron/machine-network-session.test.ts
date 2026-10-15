// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { expect, it } from 'vitest';
import { MachineNetworkSession } from './machine-network-session';
import type { MachineNetworkProtocol } from './machine-network-protocol';

class BackpressuredSocket extends EventEmitter {
  writableLength = 0;
  destroyed = false;
  readonly writes: Buffer[] = [];
  setNoDelay(): void {}
  write(data: Buffer, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(data);
    this.writableLength += data.length;
    callback?.();
    return false;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit('close');
  }
}

function fixture(protocol: MachineNetworkProtocol = 'fluidnc-telnet') {
  const socket = new BackpressuredSocket();
  const session = new MachineNetworkSession(socket as unknown as Socket, protocol);
  return { socket, session };
}

it('bounds Telnet negotiation replies even when the peer sends no controller data', async () => {
  const { socket, session } = fixture();
  socket.writableLength = 512 * 1024 - 2;
  socket.emit('data', Buffer.from([255, 253, 1]));
  expect(socket.writes).toEqual([]);
  expect(socket.destroyed).toBe(true);
  expect(await session.read()).toMatchObject({
    closed: true,
    data: '',
    error: expect.stringContaining('write queue'),
  });
});

it('counts escaped Telnet bytes against the native output queue limit', async () => {
  const { socket, session } = fixture();
  socket.writableLength = 512 * 1024 - 1;
  await expect(session.write(1, Buffer.from([255]).toString('base64'))).rejects.toThrow(
    'write queue',
  );
  expect(socket.writes).toEqual([]);
  expect(socket.destroyed).toBe(true);
});

it('does not expand a raw channel byte at the same output queue boundary', async () => {
  const { socket, session } = fixture('grblhal-raw');
  socket.writableLength = 512 * 1024 - 1;
  await session.write(1, Buffer.from([255]).toString('base64'));
  expect(socket.writes).toEqual([Buffer.from([255])]);
  expect(socket.destroyed).toBe(false);
  await expect(session.write(2, Buffer.from('?').toString('base64'))).rejects.toThrow(
    'write queue',
  );
  expect(socket.destroyed).toBe(true);
});
