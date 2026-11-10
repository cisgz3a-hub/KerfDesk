import { describe, expect, it, vi } from 'vitest';
import type { MachineNetworkRequest } from './desktop-machine-network-api';
import { createDesktopRuidaNetwork } from './desktop-ruida-network';

const ID = '12345678-1234-1234-1234-123456789abc';

/** A fake main process: reads are answered from `reads`, then held open. */
function mainProcess(reads: Array<Record<string, unknown>>) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const request: MachineNetworkRequest = vi.fn(async (action, body) => {
    calls.push([action, body]);
    if (action === 'open') return { sessionId: ID };
    if (action === 'read') {
      const next = reads.shift();
      return next ?? new Promise<Record<string, unknown>>(() => undefined);
    }
    return { written: true };
  });
  return { request, calls };
}

describe('the desktop Ruida link', () => {
  it('reads nothing until something listens', async () => {
    const { request, calls } = mainProcess([{ datagrams: ['xg=='], closed: false }]);
    const link = await createDesktopRuidaNetwork(request).open('10.0.0.2', 0x88);
    await Promise.resolve();
    expect(calls.map(([action]) => action)).toEqual(['open']);
    const heard: number[][] = [];
    link.onDatagram((datagram) => heard.push([...datagram]));
    await vi.waitFor(() => expect(heard).toEqual([[0xc6]]));
  });

  it('opens with the address and magic, and numbers each datagram once', async () => {
    const { request, calls } = mainProcess([]);
    const link = await createDesktopRuidaNetwork(request).open('192.168.1.100', 0x88);
    link.onDatagram(() => undefined);
    await link.send(Uint8Array.of(1, 2, 3));
    await link.send(Uint8Array.of(4, 5, 6));
    expect(calls.filter(([action]) => action !== 'read')).toEqual([
      ['open', { host: '192.168.1.100', magic: 0x88 }],
      ['write', { sessionId: ID, sequence: 1, data: 'AQID' }],
      ['write', { sessionId: ID, sequence: 2, data: 'BAUG' }],
    ]);
  });

  it('refuses a datagram outside 3–1472 bytes without sending it', async () => {
    const { request, calls } = mainProcess([]);
    const link = await createDesktopRuidaNetwork(request).open('10.0.0.2', 0x88);
    await expect(link.send(Uint8Array.of(1))).rejects.toThrow('3–1472');
    await expect(link.send(new Uint8Array(1473))).rejects.toThrow('3–1472');
    expect(calls.some(([action]) => action === 'write')).toBe(false);
  });

  it('delivers each datagram the controller sent, then the close and its reason', async () => {
    const { request } = mainProcess([
      { datagrams: ['xg==', 'AQID'], closed: false },
      { datagrams: [], closed: true, error: 'The UDP socket closed.' },
    ]);
    const link = await createDesktopRuidaNetwork(request).open('10.0.0.2', 0x88);
    const heard: number[][] = [];
    const reasons: Array<string | undefined> = [];
    link.onDatagram((datagram) => heard.push([...datagram]));
    const closed = new Promise<void>((resolve) =>
      link.onClose((reason) => {
        reasons.push(reason);
        resolve();
      }),
    );
    await closed;
    expect(heard).toEqual([[0xc6], [1, 2, 3]]);
    expect(reasons).toEqual(['The UDP socket closed.']);
    await expect(link.send(Uint8Array.of(1, 2, 3))).rejects.toThrow('closed');
  });

  it('closes when a read answer is malformed', async () => {
    const { request, calls } = mainProcess([{ datagrams: 'nope', closed: false }]);
    const link = await createDesktopRuidaNetwork(request).open('10.0.0.2', 0x88);
    link.onDatagram(() => undefined);
    const reason = await new Promise<string | undefined>((resolve) => link.onClose(resolve));
    expect(reason).toContain('Invalid Ruida read');
    await vi.waitFor(() => expect(calls.at(-1)?.[0]).toBe('close'));
  });
});
