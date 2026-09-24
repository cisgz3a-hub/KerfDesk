// @vitest-environment node
//
// Two identical USB serial adapters, a laser controller and an Arduino that are
// both CH340 (1A86:7523), under the two ways a host can grant serial ports:
// - every attached port, which the desktop app did while it installed an
//   origin-wide device permission handler (ADR-366), and
// - only the ports the operator picked, as Chrome does and as Electron's own
//   per-port store does once that handler is gone.
// Web Serial exposes nothing but the USB vendor and product IDs, so background
// streaming can prove it holds the picked adapter only when its twin is not
// granted (ADR-354 decision 2). This runs the production webSerial adapter, a
// Worker boundary on a real MessageChannel and the real native runtime, with
// the window and the worker each holding their own wrapper of every granted
// device, as Chromium gives each realm.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { SerialPortDouble, waitFor } from './serial-port-double.test-support';
import { createNativeSerialWorkerRuntime } from './native-serial-worker-runtime';
import { webSerial } from './web-serial';

type Adapter = { readonly window: SerialPortDouble; readonly worker: SerialPortDouble };

const channels: MessagePort[] = [];
const workers: FakeWorker[] = [];
let workerSerial: Pick<Serial, 'getPorts'> | null = null;

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  private readonly main: MessagePort;
  private readonly inner: MessagePort;

  constructor() {
    const { port1, port2 } = new MessageChannel();
    this.main = port1;
    this.inner = port2;
    channels.push(port1, port2);
    const runtime = createNativeSerialWorkerRuntime({
      serial: workerSerial,
      post: (message) => {
        if (!this.terminated) port2.postMessage(message);
      },
    });
    port2.on('message', (data) => runtime.handle(data));
    port1.on('message', (data) => this.onmessage?.({ data } as MessageEvent));
    workers.push(this);
  }

  postMessage(message: unknown): void {
    this.main.postMessage(message);
  }

  terminate(): void {
    this.terminated = true;
    this.main.close();
    this.inner.close();
  }
}

function adapter(): Adapter {
  return { window: new SerialPortDouble(), worker: new SerialPortDouble() };
}

// The operator picks the laser. `granted` is what the host lets both realms
// enumerate. Nothing orders one realm's list like the other's, so the worker
// lists them the other way round: a first match there would be the twin.
async function connectToLaser(laser: Adapter, granted: ReadonlyArray<Adapter>) {
  vi.stubGlobal('navigator', {
    serial: {
      requestPort: async () => laser.window,
      getPorts: async () => granted.map((device) => device.window),
    },
  });
  workerSerial = { getPorts: async () => [...granted].reverse().map((device) => device.worker) };
  vi.stubGlobal('Worker', FakeWorker);
  const picked = await webSerial.requestPort();
  if (picked === null) throw new Error('expected the picked port');
  return picked.open({ baudRate: 115_200, hostedStreaming: true });
}

function openedWrappers(adapters: Record<string, Adapter>): string[] {
  return Object.entries(adapters).flatMap(([name, device]) => [
    ...(device.window.opened ? [`${name} window`] : []),
    ...(device.worker.opened ? [`${name} worker`] : []),
  ]);
}

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  workers.splice(0);
  workerSerial = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('background streaming with two identical USB adapters attached', () => {
  it('streams from the worker when only the picked adapter is granted, and never opens its twin', async () => {
    const laser = adapter();
    const arduino = adapter();
    const connection = await connectToLaser(laser, [laser]);

    expect(connection.hostedStreaming).toBeDefined();
    expect(connection.backgroundStreamingUnavailable).toBeUndefined();
    expect(openedWrappers({ laser, arduino })).toEqual(['laser worker']);
    const lines: string[] = [];
    connection.onLine((line) => lines.push(line));
    laser.worker.emit('ok\r\n');
    await waitFor(() => lines.length === 1, 'the laser reply');
    await connection.write('?');
    await waitFor(() => laser.worker.transmitted.includes('?'), 'the status query');
    expect(arduino.worker.transmitted).toEqual([]);

    const laserForget = vi.spyOn(laser.window, 'forget');
    const arduinoForget = vi.spyOn(arduino.window, 'forget');
    await connection.close();
    await connection.forget?.();
    expect(openedWrappers({ laser, arduino })).toEqual([]);
    expect(laserForget).toHaveBeenCalledTimes(1);
    expect(arduinoForget).not.toHaveBeenCalled();
  });

  it('keeps the exact picked window port, and starts no worker, when every attached port is granted', async () => {
    const laser = adapter();
    const arduino = adapter();
    const connection = await connectToLaser(laser, [laser, arduino]);

    expect(openedWrappers({ laser, arduino })).toEqual(['laser window']);
    expect(workers).toHaveLength(0);
    expect(connection.backgroundStreamingUnavailable).toBe(true);
    expect(connection.hostedStreaming).toBeUndefined();
    await connection.write('?');
    await waitFor(() => laser.window.transmitted.includes('?'), 'the status query');
    expect(arduino.window.transmitted).toEqual([]);
    await connection.close();
    expect(openedWrappers({ laser, arduino })).toEqual([]);
  });
});
