import { expect, it, vi } from 'vitest';
import { createDesktopMachineNetwork } from './desktop-machine-network';
import type { MachineNetworkRequest } from './desktop-machine-network-api';
import type { SerialConnection } from '../types';

const ID = '12345678-1234-1234-1234-123456789abc';
async function connection(request: MachineNetworkRequest): Promise<SerialConnection> {
  const adapter = createDesktopMachineNetwork(request).serialForTarget('127.0.0.1', 23);
  const port = await adapter.requestPort();
  if (port === null) throw new Error('Missing network port');
  expect(port.info).toEqual({ transport: 'tcp' });
  return port.open({ baudRate: 115200 });
}

it('orders writes and preserves raw realtime bytes without sending host details after open', async () => {
  const packets: Array<Record<string, unknown>> = [];
  let release: (() => void) | undefined;
  const request: MachineNetworkRequest = async (action, body) => {
    if (action === 'open') return { sessionId: ID };
    if (action === 'write') {
      packets.push(body);
      if (packets.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
    }
    return {};
  };
  const serial = await connection(request);
  const first = serial.write('\x85');
  const second = serial.write('G1 X1\n');
  await Promise.resolve();
  expect(packets).toHaveLength(1);
  expect(packets[0]?.['data']).toBe(btoa('\x85'));
  release?.();
  await Promise.all([first, second]);
  expect(packets.map((packet) => packet['sequence'])).toEqual([1, 2]);
  expect(JSON.stringify(packets)).not.toContain('127.0.0.1');
  await serial.close();
});

it('closes on uncertain write delivery, never retries it, and refuses queued continuation', async () => {
  const request = vi.fn<MachineNetworkRequest>(async (action) => {
    if (action === 'open') return { sessionId: ID };
    if (action === 'write') throw new Error('Lost delivery receipt');
    return {};
  });
  const serial = await connection(request);
  const closed = vi.fn();
  serial.onClose(closed);
  const results = await Promise.allSettled([serial.write('G1 X1\n'), serial.write('G1 X2\n')]);
  expect(results.every((result) => result.status === 'rejected')).toBe(true);
  expect(request.mock.calls.filter(([action]) => action === 'write')).toHaveLength(1);
  expect(request.mock.calls.filter(([action]) => action === 'close')).toHaveLength(1);
  expect(closed).toHaveBeenCalledTimes(1);
});

it('retains split UTF-8 and CRLF records and closes once on read-channel loss', async () => {
  const chunks = [
    Uint8Array.from([91, 77, 83, 71, 58, 0xc2]),
    Uint8Array.from([0xb5, 93, 13]),
    Uint8Array.from([10, 111, 107, 10]),
  ];
  const request: MachineNetworkRequest = async (action) => {
    if (action === 'open') return { sessionId: ID };
    if (action !== 'read') return {};
    const next = chunks.shift();
    return next === undefined
      ? { data: '', closed: true }
      : {
          data: btoa(Array.from(next, (byte) => String.fromCharCode(byte)).join('')),
          closed: false,
        };
  };
  const serial = await connection(request);
  const lines: string[] = [];
  const closed = vi.fn();
  serial.onClose(closed);
  serial.onLine((line) => lines.push(line));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  expect(lines).toEqual(['[MSG:µ]', 'ok']);
  expect(closed).toHaveBeenCalledTimes(1);
  await expect(serial.write('?')).rejects.toThrow('closed');
});

it('closes on oversized terminated lines instead of delivering their tail or a following ok', async () => {
  const request: MachineNetworkRequest = async (action) =>
    action === 'open'
      ? { sessionId: ID }
      : action === 'read'
        ? { data: btoa('x'.repeat(65537) + '\nok\n'), closed: false }
        : {};
  const serial = await connection(request);
  const lines: string[] = [];
  const closed = vi.fn();
  serial.onClose(closed);
  serial.onLine((line) => lines.push(line));
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  expect(lines).toEqual([]);
  expect(closed).toHaveBeenCalledTimes(1);
});
