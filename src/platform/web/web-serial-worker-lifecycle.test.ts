// @vitest-environment node
//
// The worker-hosted transport end to end, on the native worker that ADR-354
// made the hosted path: the production webSerial adapter, a Worker whose
// boundary is a real MessageChannel, the real native runtime and worker core
// owning the port inside that worker, and a SerialPort double that behaves
// like Chromium's (serial-port-double). The audit fixes first made for the
// transferred-stream transport (connect-1, transport-3, transport-4) must hold
// on this path too.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import type { SerialConnection } from '../types';
import { SerialPortDouble, waitFor } from './serial-port-double.test-support';
import { createNativeSerialWorkerRuntime } from './native-serial-worker-runtime';
import { webSerial } from './web-serial';

const channels: MessagePort[] = [];
const workers: FakeWorker[] = [];

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
    // The worker's own navigator.serial grants the same port the window
    // picked, as Chromium does for a dedicated worker.
    const runtime = createNativeSerialWorkerRuntime({
      serial: (globalThis.navigator as { serial?: Pick<Serial, 'getPorts'> }).serial ?? null,
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

type Session = {
  readonly connection: SerialConnection;
  readonly lines: string[];
  readonly closes: () => number;
};

async function connectHosted(port: SerialPortDouble): Promise<Session> {
  vi.stubGlobal('navigator', {
    serial: { getPorts: async () => [port], requestPort: async () => port },
  });
  vi.stubGlobal('Worker', FakeWorker);
  const ref = await webSerial.requestPort();
  if (ref === null) throw new Error('expected a port');
  const connection = await ref.open({ baudRate: 115200, hostedStreaming: true });
  expect(workers).toHaveLength(1);
  const lines: string[] = [];
  let closes = 0;
  connection.onLine((line) => lines.push(line));
  connection.onClose(() => {
    closes += 1;
  });
  port.emit('ok\r\n');
  await waitFor(() => lines.length === 1, 'the first line');
  return { connection, lines, closes: () => closes };
}

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  workers.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('worker-hosted transport: UART line errors (audit connect-1)', () => {
  it.each(['FramingError', 'ParityError', 'BreakError', 'BufferOverrunError'])(
    'reads on after a %s: no close, later lines arrive, writes still reach the port',
    async (name) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const port = new SerialPortDouble();
      const session = await connectHosted(port);

      port.readError(name);
      port.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>\r\nok\r\n');
      await waitFor(() => session.lines.length === 3, 'the lines after the error');
      await session.connection.write('?');
      await waitFor(() => port.transmitted.includes('?'), 'the write');

      expect(session.lines).toEqual(['ok', '<Idle|MPos:0.000,0.000,0.000|FS:0,0>', 'ok']);
      expect(session.closes()).toBe(0);
      expect(workers[0]?.terminated).toBe(false);
      await session.connection.close();
      expect(port.opened).toBe(false);
    },
  );
});

describe('worker-hosted transport: teardown after the worker ends the session (audit transport-3)', () => {
  it('frees the port for the next Connect after a read error it cannot recover from', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connectHosted(port);

    // An unspecified OS error: Chromium leaves the port open, but nothing says
    // the link survives it, so the session ends as for a dropped cable.
    port.readError('UnknownError');
    await waitFor(() => session.closes() === 1, 'the session to end');
    await waitFor(() => workers[0]?.terminated === true && !port.opened, 'the port to be freed');

    const again = await webSerial.requestPort();
    if (again === null) throw new Error('expected a port');
    const next = await again.open({ baudRate: 115200, hostedStreaming: true });
    expect(port.opened).toBe(true);
    await next.close();
  });

  it('stops the worker after a cable pull instead of leaking it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const port = new SerialPortDouble();
    const session = await connectHosted(port);

    port.unplug();
    await waitFor(() => session.closes() === 1, 'the session to end');
    await waitFor(() => workers[0]?.terminated === true, 'the worker to stop');

    await expect(session.connection.write('?')).rejects.toThrow('not writable');
  });
});

describe('worker-hosted transport: Disconnect drains before closing (audit transport-4)', () => {
  it('delivers the M5/M9 cleanup lines queued last before the port closes', async () => {
    const port = new SerialPortDouble();
    const session = await connectHosted(port);

    // The disconnect transaction awaits each cleanup write, then closes.
    await session.connection.write('M5\n');
    await session.connection.write('M9\n');
    await session.connection.close();

    expect(port.flushed).toEqual([]);
    expect(port.transmitted).toEqual(['M5\n', 'M9\n']);
    expect(port.opened).toBe(false);
    expect(workers[0]?.terminated).toBe(true);
  });
});
