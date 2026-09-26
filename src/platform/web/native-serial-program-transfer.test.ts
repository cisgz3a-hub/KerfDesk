// @vitest-environment node
//
// The run's program on the production native path (ADR-354 Amendment 3): the
// webSerial adapter, a Worker whose boundary is a real MessageChannel that
// honours transfer lists, the real native runtime and worker core owning a
// SerialPort double, and the real refill handover. The program must cross
// once, moved rather than copied, and a Pause and Resume must re-arm the same
// run from its position alone, with every line still sent once and in order.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import {
  createStreamer,
  pause,
  resume,
  step,
  type StreamerState,
} from '../../core/controllers/grbl';
import { pumpInboundLine } from '../../core/controllers/grbl/stream-pump';
import type { SerialConnection } from '../types';
import { createNativeSerialWorkerRuntime } from './native-serial-worker-runtime';
import type {
  NativeSerialWorkerRequest,
  NativeSerialWorkerResponse,
} from './native-serial-worker-protocol';
import { SerialPortDouble, waitFor } from './serial-port-double.test-support';
import { webSerial } from './web-serial';

type Posted = {
  readonly message: NativeSerialWorkerRequest;
  readonly transfer: ReadonlyArray<ArrayBuffer>;
  /** The JSON size of what a structured clone copies; transferred buffers print as {}. */
  readonly copiedChars: number;
};

const channels: MessagePort[] = [];
const workers: TransferringWorker[] = [];

class TransferringWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminated = false;
  readonly posted: Posted[] = [];
  readonly replies: NativeSerialWorkerResponse[] = [];
  private readonly main: MessagePort;
  private readonly inner: MessagePort;

  constructor() {
    const { port1, port2 } = new MessageChannel();
    this.main = port1;
    this.inner = port2;
    channels.push(port1, port2);
    const runtime = createNativeSerialWorkerRuntime({
      serial: (globalThis.navigator as { serial?: Pick<Serial, 'getPorts'> }).serial ?? null,
      post: (message) => {
        if (!this.terminated) port2.postMessage(message);
      },
    });
    port2.on('message', (data: NativeSerialWorkerRequest) => runtime.handle(data));
    port1.on('message', (data: NativeSerialWorkerResponse) => {
      this.replies.push(data);
      this.onmessage?.({ data } as MessageEvent);
    });
    workers.push(this);
  }

  postMessage(message: NativeSerialWorkerRequest, transfer: ArrayBuffer[] = []): void {
    const copiedChars = JSON.stringify(message).length;
    this.main.postMessage(message, transfer);
    this.posted.push({ message, transfer, copiedChars });
  }

  terminate(): void {
    this.terminated = true;
    this.main.close();
    this.inner.close();
  }
}

// The controller answers every line it received with `ok`, as GRBL does, and
// keeps answering the lines it holds while the sender pauses.
function acknowledgeEveryLine(port: SerialPortDouble): () => void {
  let answered = 0;
  const timer = setInterval(() => {
    const received = port.transmitted.join('').split('\n').length - 1;
    for (; answered < received; answered += 1) port.emit('ok\r\n');
  }, 1);
  return () => clearInterval(timer);
}

async function connectHosted(port: SerialPortDouble): Promise<SerialConnection> {
  vi.stubGlobal('navigator', {
    serial: { getPorts: async () => [port], requestPort: async () => port },
  });
  vi.stubGlobal('Worker', TransferringWorker);
  const ref = await webSerial.requestPort();
  if (ref === null) throw new Error('expected a port');
  const connection = await ref.open({ baudRate: 115_200, hostedStreaming: true });
  expect(workers).toHaveLength(1);
  return connection;
}

afterEach(() => {
  for (const channel of channels.splice(0)) channel.close();
  workers.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('native worker: the program crosses once per run', () => {
  it('moves the program once and re-arms a Resume from its position alone', async () => {
    const port = new SerialPortDouble();
    const connection = await connectHosted(port);
    const hosted = connection.hostedStreaming;
    if (hosted === undefined) throw new Error('expected the native worker to host the refill');
    const programLines = Array.from({ length: 60 }, (_, i) => `G1 X${i + 1}.000 S1000\n`);
    const first = step(createStreamer(programLines.join(''), { rxBufferBytes: 48 }));
    let main: StreamerState = first.state;
    connection.onLine((line) => {
      const pumped = pumpInboundLine(main, line);
      main = pumped.streamer;
      if (!hosted.isArmed() && pumped.toSend !== '') void connection.write(pumped.toSend);
    });
    const stopAcknowledging = acknowledgeEveryLine(port);
    try {
      await connection.write(first.toSend);
      await hosted.arm(() => main);
      expect(hosted.isArmed()).toBe(true);
      await waitFor(() => main.completed >= 20, 'the worker to refill part of the job');

      // Pause: take the refill back, then stop sending.
      await hosted.release();
      main = pause(main);
      await waitFor(() => main.inFlight.length === 0, 'the held lines to be acknowledged');
      const pausedAt = main.completed;
      expect(pausedAt).toBeLessThan(programLines.length);

      // Resume: the first window from here, then the same ready barrier.
      const resumed = step(resume(main));
      main = resumed.state;
      await connection.write(resumed.toSend);
      await hosted.arm(() => main);
      expect(hosted.isArmed()).toBe(true);
      await waitFor(() => main.status === 'done', 'the whole job');
      await hosted.release();
    } finally {
      stopAcknowledging();
    }

    const worker = workers[0];
    if (worker === undefined) throw new Error('expected the native worker');
    const programs = worker.posted.filter(({ message }) => message.kind === 'program');
    const arms = worker.posted.filter(({ message }) => message.kind === 'arm');
    expect(programs).toHaveLength(1);
    expect(arms).toHaveLength(2);
    // Moved, not copied: the transferred buffers are empty on this side.
    expect(programs[0]?.transfer.map((buffer) => buffer.byteLength)).toEqual([0, 0]);
    expect(programs[0]?.copiedChars).toBeLessThan(100);
    const programId = programs[0]?.message.kind === 'program' ? programs[0].message.programId : 0;
    for (const arm of arms) {
      expect(arm.message).toMatchObject({ programId });
      expect(arm.message).not.toHaveProperty('streamer');
      expect(arm.copiedChars).toBeLessThan(1_000);
    }
    // Every line reached the controller exactly once, in order.
    expect(port.transmitted.join('')).toBe(programLines.join(''));
    // The worker let go of the program with the stream that had ended.
    expect(worker.replies.filter((reply) => reply.kind === 'released').at(-1)).toMatchObject({
      retiredProgram: programId,
    });
    await connection.close();
    expect(port.opened).toBe(false);
    expect(worker.terminated).toBe(true);
  });
});
