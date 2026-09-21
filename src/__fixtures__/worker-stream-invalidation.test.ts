import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, idleCollector, step } from '../core/controllers/grbl';
import { createSerialWorkerCore } from '../platform/web/serial-worker-core';
import type {
  SerialWorkerRequest,
  SerialWorkerResponse,
} from '../platform/web/serial-worker-protocol';
import { createWorkerSerialConnection } from '../platform/web/worker-serial-connection';
import { cancelScheduledControllerQualification } from '../ui/state/laser-controller-qualification';
import { armHostedRefill } from '../ui/state/laser-hosted-refill';
import { handleLine } from '../ui/state/laser-line-handler';
import { makeLineHandlerHarness } from '../ui/state/laser-line-handler.test-support';
import type { SafeWriteFn } from '../ui/state/laser-line-shared';
import { useStore } from '../ui/state/store';

afterEach(() => useStore.getState().setCncLiveCaps(null));

async function flushTasks(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

/** Exercise both refill owners and the real renderer line pipeline. */
function harness() {
  const main = makeLineHandlerHarness();
  main.refs.settingsCollector = idleCollector();
  const toWorker: SerialWorkerRequest[] = [];
  const toRenderer: SerialWorkerResponse[] = [];
  const written: string[] = [];
  const delivered: string[] = [];
  let feed: ReadableStreamDefaultController<Uint8Array> | undefined;
  let onMessage: ((message: SerialWorkerResponse) => void) | null = null;
  let terminated = false;
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
  const core = createSerialWorkerCore({ post: (message) => toRenderer.push(message) });
  const connection = createWorkerSerialConnection({
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
  main.refs.connection = connection;
  const safeWrite: SafeWriteFn = (line) => connection.write(line);
  connection.onLine((line) => {
    delivered.push(line);
    handleLine(main.set, main.get, main.refs, safeWrite, line);
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) {
      for (let message = toWorker.shift(); message !== undefined; message = toWorker.shift())
        core.handle(message);
      await flushTasks();
      for (let message = toRenderer.shift(); message !== undefined; message = toRenderer.shift())
        onMessage?.(message);
      await flushTasks();
    }
  };
  return {
    connection,
    written,
    delivered,
    get: main.get,
    receiveChunk: (chunk: string) => feed?.enqueue(new TextEncoder().encode(chunk)),
    settle,
    start: async () => {
      const first = step(
        createStreamer('G1 X1.000\nG1 X2.000\nG1 X3.000\n', { rxBufferBytes: 11 }),
      );
      main.set({ streamer: first.state, mpgActive: false });
      const firstWrite = safeWrite(first.toSend, 'start');
      await settle();
      await firstWrite;
      const arming = armHostedRefill(main.refs, () => main.get().streamer);
      await settle();
      await arming;
      expect(connection.hostedStreaming?.isArmed()).toBe(true);
    },
    close: async () => {
      cancelScheduledControllerQualification(main.refs);
      const closing = connection.close();
      await settle();
      await closing;
    },
  };
}

describe('worker refill and real store invalidation', () => {
  it.each([
    ['GRBL reboot', "Grbl 1.1h ['$' for help]", 'errored'],
    ['grblHAL reboot', "GrblHAL 1.1f ['$' for help]", 'errored'],
    ['FluidNC reboot', 'Grbl 3.7 [FluidNC v3.7.0]', 'errored'],
    ['foreign controller reboot', 'start', 'errored'],
    ['MPG takeover', '<Run|MPos:1,0,0|FS:100,0|MPG:1>', 'paused'],
    ['Alarm status', '<Alarm|MPos:1,0,0|FS:0,0>', 'cancelled'],
    ['Sleep status', '<Sleep|MPos:1,0,0|FS:0,0>', 'cancelled'],
  ])('sends no further motion after %s and an ACK in the same chunk', async (_, line, status) => {
    const h = harness();
    try {
      await h.start();
      h.receiveChunk(`${line}\nok\n`);
      await h.settle();

      expect(h.delivered).toEqual([line, 'ok']);
      expect(h.get().streamer?.status).toBe(status);
      expect(h.connection.hostedStreaming?.isArmed()).toBe(false);
      expect(h.written).toEqual(['G1 X1.000\n']);

      // Later replies from the old stream or cleanup cannot restart either owner.
      h.receiveChunk('ok\nok\n');
      await h.settle();
      expect(h.written).toEqual(['G1 X1.000\n']);
    } finally {
      await h.close();
    }
  });

  it('continues once per ACK after a benign Run status in the same chunk', async () => {
    const h = harness();
    try {
      await h.start();
      h.receiveChunk('<Run|MPos:1,0,0|FS:100,0|MPG:0>\nok\n');
      await h.settle();

      expect(h.written).toEqual(['G1 X1.000\n', 'G1 X2.000\n']);
      expect(h.get().streamer?.completed).toBe(1);
      expect(h.get().streamer?.status).toBe('streaming');
      expect(h.connection.hostedStreaming?.isArmed()).toBe(true);
    } finally {
      await h.close();
    }
  });
});
