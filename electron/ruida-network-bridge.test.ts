// @vitest-environment node
// The main process's Ruida UDP bridge (ADR-697) against a loopback UDP
// "controller": datagrams pass both ways, only the controller's own address
// and port are heard, nothing is replayed, and a session the window can no
// longer reach — a crashed renderer, the app quitting — gets Stop Process.
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ruidaCommandDatagram,
  swizzleByte,
  RUIDA_STOP_PROCESS,
} from '../src/core/controllers/ruida';
import { installRendererCrashRecovery, type RendererGoneReason } from './renderer-crash-recovery';
import { RuidaNetworkBridge, validateRuidaTarget } from './ruida-network-bridge';
import { withRuidaNetworkRoutes } from './ruida-network-routes';
import { ruidaStopDatagram } from './ruida-network-wire';
vi.mock('electron', () => ({ app: { once: vi.fn() } }));

const sockets: Socket[] = [];
const bridges: RuidaNetworkBridge[] = [];
afterEach(async () => {
  for (const bridge of bridges.splice(0)) {
    bridge.dispose();
    await bridge.settled();
  }
  for (const socket of sockets.splice(0)) socket.close();
});

type Heard = { readonly bytes: Buffer; readonly from: RemoteInfo };

async function udp(): Promise<{ socket: Socket; port: number; heard: Heard[] }> {
  const socket = createSocket('udp4');
  sockets.push(socket);
  const heard: Heard[] = [];
  socket.on('message', (bytes, from) => heard.push({ bytes, from }));
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  return { socket, port: socket.address().port, heard };
}

async function opened() {
  const controller = await udp();
  const bridge = new RuidaNetworkBridge({ controllerPort: controller.port, listenPort: 0 });
  bridges.push(bridge);
  const { sessionId } = await bridge.open('127.0.0.1', 0x88);
  return { controller, bridge, sessionId };
}

async function until(check: () => boolean): Promise<void> {
  for (let tries = 0; tries < 200 && !check(); tries += 1)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

const DATAGRAM = Buffer.from(ruidaCommandDatagram([0xda, 0x00, 0x04, 0x00]));
const ACK = Buffer.of(swizzleByte(0xcc));

describe('the Ruida UDP bridge', () => {
  it('mirrors the core Stop Process datagram for every swizzle magic', () => {
    for (const magic of [0x88, 0x11, 0x00, 0xff])
      expect([...ruidaStopDatagram(magic)]).toEqual([
        ...ruidaCommandDatagram(RUIDA_STOP_PROCESS, magic),
      ]);
  });

  it('accepts only private-network IPv4 literals', () => {
    for (const host of ['192.168.1.100', '10.0.0.7', '172.16.4.2', '127.0.0.1'])
      expect(() => validateRuidaTarget(host)).not.toThrow();
    for (const host of ['8.8.8.8', 'ruida.local', '', 'fd00::1', '192.168.1.100:50200'])
      expect(() => validateRuidaTarget(host)).toThrow('private-network IPv4');
  });

  it('carries a datagram out and the controller’s reply back', async () => {
    const { controller, bridge, sessionId } = await opened();
    await bridge.write(sessionId, 1, DATAGRAM.toString('base64'));
    await until(() => controller.heard.length === 1);
    expect(controller.heard[0]?.bytes).toEqual(DATAGRAM);
    const from = controller.heard[0]?.from;
    if (from === undefined) throw new Error('nothing heard');
    controller.socket.send(ACK, from.port, '127.0.0.1');
    const read = await bridge.read(sessionId);
    expect(read).toEqual({ datagrams: [ACK.toString('base64')], closed: false });
  });

  it('ignores datagrams from any other port, so no other host answers for the controller', async () => {
    const { controller, bridge, sessionId } = await opened();
    await bridge.write(sessionId, 1, DATAGRAM.toString('base64'));
    await until(() => controller.heard.length === 1);
    const intruder = await udp();
    const port = controller.heard[0]?.from.port ?? 0;
    intruder.socket.send(ACK, port, '127.0.0.1');
    const read = await bridge.read(sessionId);
    expect(read.datagrams).toEqual([]);
  });

  it('never replays: a repeated sequence closes the session with Stop Process', async () => {
    const { controller, bridge, sessionId } = await opened();
    await bridge.write(sessionId, 1, DATAGRAM.toString('base64'));
    await expect(bridge.write(sessionId, 1, DATAGRAM.toString('base64'))).rejects.toThrow(
      'sequence',
    );
    await until(() => controller.heard.length === 2);
    expect(controller.heard.map((entry) => entry.bytes)).toEqual([
      DATAGRAM,
      ruidaStopDatagram(0x88),
    ]);
    expect((await bridge.read(sessionId)).closed).toBe(true);
  });

  it('refuses a second session, and a datagram over 1472 bytes', async () => {
    const { bridge, sessionId } = await opened();
    await expect(bridge.open('127.0.0.1', 0x88)).rejects.toThrow('Disconnect the current');
    const oversized = Buffer.alloc(1473, 1).toString('base64');
    await expect(bridge.write(sessionId, 1, oversized)).rejects.toThrow('Invalid Ruida datagram');
  });

  it('names the other Ruida program when the reply port is taken', async () => {
    // Held on every interface, as LightBurn holds 40200.
    const holder = createSocket('udp4');
    sockets.push(holder);
    await new Promise<void>((resolve) => holder.bind({ port: 0, exclusive: true }, resolve));
    const bridge = new RuidaNetworkBridge({
      controllerPort: 50200,
      listenPort: holder.address().port,
    });
    bridges.push(bridge);
    await expect(bridge.open('127.0.0.1', 0x88)).rejects.toThrow('LightBurn');
  });

  it('closes on the window’s own Close without a stop', async () => {
    const { controller, bridge, sessionId } = await opened();
    bridge.close(sessionId);
    await bridge.settled();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(controller.heard).toEqual([]);
    expect(() => bridge.read(sessionId)).toThrow('unavailable');
  });
});

describe('a session the window can no longer reach (crash stop)', () => {
  function crashWindow() {
    const webContents = Object.assign(new EventEmitter(), { reload: vi.fn() });
    const window = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents });
    const crash = (reason: RendererGoneReason): void => {
      webContents.emit('render-process-gone', {}, { reason });
    };
    return { window, crash };
  }

  it('sends Stop Process when the renderer crashes mid-job, and frees the port for Reconnect', async () => {
    const { controller, bridge, sessionId } = await opened();
    await bridge.write(sessionId, 1, DATAGRAM.toString('base64'));
    const { window, crash } = crashWindow();
    installRendererCrashRecovery(window, {
      isClosing: () => false,
      stopMachine: () => bridge.stopAll(),
      askToReload: async () => false,
    });
    crash('oom');
    expect(() => bridge.read(sessionId)).toThrow('unavailable');
    await until(() => controller.heard.length === 2);
    expect(controller.heard[1]?.bytes).toEqual(ruidaStopDatagram(0x88));
    await bridge.settled();
    const next = await bridge.open('127.0.0.1', 0x88);
    expect(next.sessionId).not.toBe(sessionId);
  });

  it('reports the stop the OS took when every session is stopped', async () => {
    const { controller, bridge } = await opened();
    await expect(bridge.stopAll()).resolves.toEqual({ sessions: 1, sent: 1 });
    await until(() => controller.heard.length === 1);
    expect(controller.heard[0]?.bytes).toEqual(ruidaStopDatagram(0x88));
  });

  it('stops a session whose window stopped reading for the lease', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { controller, bridge, sessionId } = await opened();
      vi.advanceTimersByTime(15_000);
      vi.useRealTimers();
      await until(() => controller.heard.length === 1);
      expect(controller.heard[0]?.bytes).toEqual(ruidaStopDatagram(0x88));
      expect(() => bridge.read(sessionId)).toThrow('unavailable');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the Ruida routes', () => {
  it('require the exact trusted app route and header before opening a socket', async () => {
    const bridge = new RuidaNetworkBridge();
    bridges.push(bridge);
    const opening = vi.spyOn(bridge, 'open');
    const fallback = vi.fn(async () => new Response('fallback'));
    const route = withRuidaNetworkRoutes(fallback, bridge);
    for (const [url, headers] of [
      ['app://app/api/ruida-network/open', {}],
      ['app://app/api/ruida-network/open', { 'X-KerfDesk-Machine-Network': '1' }],
      ['app://app/api/ruida-network/open?x=1', { 'X-KerfDesk-Ruida-Network': '1' }],
      [
        'app://app/api/ruida-network/open',
        { 'X-KerfDesk-Ruida-Network': '1', Origin: 'https://evil.invalid' },
      ],
    ] as const)
      expect((await route(new Request(url, { method: 'POST', headers, body: '{}' }))).status).toBe(
        404,
      );
    expect(opening).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('pass the address and magic to the bridge, and refuse a public address', async () => {
    const bridge = new RuidaNetworkBridge();
    bridges.push(bridge);
    const route = withRuidaNetworkRoutes(async () => new Response('fallback'), bridge);
    const open = (body: unknown) =>
      route(
        new Request('app://app/api/ruida-network/open', {
          method: 'POST',
          headers: { 'X-KerfDesk-Ruida-Network': '1' },
          body: JSON.stringify(body),
        }),
      );
    const refused = await open({ host: '8.8.8.8', magic: 0x88 });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: expect.stringContaining('private-network') });
    const opening = vi
      .spyOn(bridge, 'open')
      .mockResolvedValue({ sessionId: '12345678-1234-1234-1234-123456789abc' });
    expect((await open({ host: '192.168.1.100', magic: 0x88 })).status).toBe(200);
    expect(opening).toHaveBeenCalledWith('192.168.1.100', 0x88);
  });
});
