import { createStreamer, step } from '../../core/controllers/grbl';
import { pumpInboundLine } from '../../core/controllers/grbl/stream-pump';
import { createSerialWorkerCore } from './serial-worker-core';
import { createWorkerSerialConnection } from './worker-serial-connection';
import type { SerialWorkerRequest, SerialWorkerResponse } from './serial-worker-protocol';

export async function flushWorkerTasks(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Real worker core and connection; only message delivery is controlled. */
export function handoverHarness() {
  const toWorker: SerialWorkerRequest[] = [];
  const toMain: SerialWorkerResponse[] = [];
  const written: string[] = [];
  const delivered: string[] = [];
  let terminated = false;
  let closed = false;
  let onMessage: ((message: SerialWorkerResponse) => void) | null = null;
  const { readable, writable, ack } = testStreams(written);
  const core = createSerialWorkerCore({ post: (message) => toMain.push(message) });
  const connection = createWorkerSerialConnection({
    timeoutMs: 100,
    bridge: {
      postMessage: (message) => {
        if (!terminated) toWorker.push(message);
      },
      onMessage: (handler) => {
        onMessage = handler;
        return () => {
          onMessage = null;
        };
      },
      terminate: () => {
        terminated = true;
        toWorker.length = 0;
        core.handle({ kind: 'close' });
      },
    },
    port: { readable, writable, close: async () => undefined },
  });
  const first = step(createStreamer('G1 X1.000\nG1 X2.000\nG1 X3.000\n', { rxBufferBytes: 11 }));
  let main = first.state;
  connection.onClose(() => {
    closed = true;
  });
  connection.onLine((line) => {
    delivered.push(line);
    const pumped = pumpInboundLine(main, line);
    main = pumped.streamer;
    if (connection.hostedStreaming?.isArmed() !== true && pumped.toSend !== '')
      void connection.write(pumped.toSend);
  });
  const worker = (): void => drainMessages(toWorker, core.handle);
  const renderer = (): void => drainMessages(toMain, (message) => onMessage?.(message));
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
      worker();
      await flushWorkerTasks();
      renderer();
      await flushWorkerTasks();
    }
  };
  return {
    core,
    connection,
    written,
    delivered,
    worker,
    renderer,
    settle,
    isClosed: () => closed,
    isTerminated: () => terminated,
    snapshot: () => main,
    ack,
    start: async () => {
      worker();
      const write = connection.write(first.toSend);
      await settle();
      await write;
    },
    close: async () => {
      const closing = connection.close();
      await settle();
      await closing;
    },
  };
}

function drainMessages<T>(queue: T[], deliver: (message: T) => void): void {
  for (let message = queue.shift(); message !== undefined; message = queue.shift())
    deliver(message);
}

function testStreams(written: string[]) {
  let feed: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      feed = controller;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write(bytes) {
      written.push(new TextDecoder().decode(bytes));
    },
  });
  return { readable, writable, ack: () => feed?.enqueue(new TextEncoder().encode('ok\n')) };
}
