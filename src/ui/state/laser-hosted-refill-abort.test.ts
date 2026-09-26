// Abort with the worker-hosted refill armed (ADR-334), end to end through the
// production pieces: store stopJob, the real worker connection and handover,
// the real worker core on real streams, and the GRBL simulator. Only message
// delivery between the two "threads" is modelled: worker to renderer is one
// FIFO the renderer drains at a per-message cost, renderer to worker is
// delivered on the next microtask unless the worker is modelled as stalled.
// The oracle is the byte stream the simulated controller received.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { GRBL_PLANNER_BLOCKS } from '../../__fixtures__/controllers/grbl-sim-planner';
import { grblDriver } from '../../core/controllers';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { createSerialWorkerCore } from '../../platform/web/serial-worker-core';
import type {
  SerialWorkerRequest,
  SerialWorkerResponse,
} from '../../platform/web/serial-worker-protocol';
import {
  createWorkerSerialConnection,
  WORKER_HANDSHAKE_TIMEOUT_MS,
} from '../../platform/web/worker-serial-connection';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { resetStore } from './test-helpers';

const RENDERER_STALL_MS = 1_000;
// A worker with nothing queued ahead of it writes within a tick or two.
const PROMPT_RESET_MS = 20;

type Threads = {
  rendererCostMs: number;
  rendererStalledUntil: number;
  workerStalledUntil: number;
  terminated: boolean;
  readonly toMain: SerialWorkerResponse[];
  readonly workerInbox: SerialWorkerRequest[];
  connection: SerialConnection | null;
};

function latin1(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0) & 0xff);
}

function workerHostedAdapter(sim: GrblSimulator, threads: Threads): PlatformAdapter {
  const open = async (): Promise<SerialConnection> => {
    const port = await sim.adapter.serial.requestPort();
    if (port === null) throw new Error('no simulated port');
    const wire = await port.open({ baudRate: 115_200 });
    let feed: ReadableStreamDefaultController<Uint8Array> | undefined;
    const readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        feed = controller;
      },
    });
    wire.onLine((line) => {
      try {
        feed?.enqueue(latin1(`${line}\n`));
      } catch {
        // The worker cancelled its reader on close.
      }
    });
    const writable = new WritableStream<Uint8Array>({
      write: async (bytes) => wire.write(String.fromCharCode(...bytes)),
    });
    const core = createSerialWorkerCore({ post: (message) => threads.toMain.push(message) });
    let onMain: ((message: SerialWorkerResponse) => void) | null = null;
    const drainWorker = (): void => {
      if (Date.now() < threads.workerStalledUntil) return;
      for (let m = threads.workerInbox.shift(); m !== undefined; m = threads.workerInbox.shift()) {
        core.handle(m);
      }
    };
    let rendererFreeAt = 0;
    const rendererTick = setInterval(() => {
      drainWorker();
      const now = Date.now();
      if (now < threads.rendererStalledUntil) return;
      while (threads.toMain.length > 0 && now >= rendererFreeAt) {
        onMain?.(threads.toMain.shift() as SerialWorkerResponse);
        if (threads.rendererCostMs > 0) rendererFreeAt = now + threads.rendererCostMs;
      }
    }, 1);
    const connection = createWorkerSerialConnection({
      bridge: {
        postMessage: (message) => {
          if (threads.terminated) return;
          threads.workerInbox.push(message);
          void Promise.resolve().then(drainWorker);
        },
        onMessage: (handler) => {
          onMain = handler;
          return () => {
            onMain = null;
          };
        },
        terminate: () => {
          threads.terminated = true;
          threads.workerInbox.length = 0;
          clearInterval(rendererTick);
          core.handle({ kind: 'close' });
        },
      },
      port: { readable, writable, close: async () => wire.close() },
    });
    threads.connection = connection;
    return connection;
  };
  return {
    ...sim.adapter,
    serial: { isSupported: () => true, requestPort: async () => ({ open }) },
  };
}

function newThreads(): Threads {
  return {
    rendererCostMs: 0,
    rendererStalledUntil: 0,
    workerStalledUntil: 0,
    terminated: false,
    toMain: [],
    workerInbox: [],
    connection: null,
  };
}

const JOB = Array.from(
  { length: 4_000 },
  (_, i) => `G1 X${(i % 200) + 1} Y${Math.floor(i / 200) + 1} F3000 S200`,
).join('\n');

async function connectAndStartHosted(sim: GrblSimulator, threads: Threads): Promise<void> {
  await useLaserStore
    .getState()
    .connect(workerHostedAdapter(sim, threads), { hostedStreaming: true });
  await vi.advanceTimersByTimeAsync(1_500);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  const starting = startTestLaserJob(JOB);
  await vi.advanceTimersByTimeAsync(200);
  await starting;
  expect(threads.connection?.hostedStreaming?.isArmed()).toBe(true);
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

function resetReceived(sim: GrblSimulator): boolean {
  return sim.outbound().some((payload) => payload.includes(RT_SOFT_RESET));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  const closing = useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  await vi.advanceTimersByTimeAsync(5_000);
  await closing;
  vi.useRealTimers();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    alarmCode: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

describe('Abort with the worker-hosted refill armed', () => {
  it('puts the soft reset on the wire without waiting for the renderer backlog', async () => {
    const sim = createGrblSimulator({ plannerBlocks: GRBL_PLANNER_BLOCKS, blockRetireMs: 4 });
    const threads = newThreads();
    await connectAndStartHosted(sim, threads);
    // A main-thread stall: the armed worker keeps refilling, so forwarded
    // lines pile up for a renderer that then drains them at 1 ms each. The
    // Abort click is input and runs ahead of that backlog.
    threads.rendererCostMs = 1;
    threads.rendererStalledUntil = Date.now() + RENDERER_STALL_MS;
    await vi.advanceTimersByTimeAsync(RENDERER_STALL_MS - 1);
    expect(threads.toMain.length).toBeGreaterThan(50);

    const abortAt = Date.now();
    const stopping = useLaserStore
      .getState()
      .stopJob()
      .catch((error: unknown) => error);
    let resetDelayMs: number | null = null;
    while (Date.now() - abortAt < WORKER_HANDSHAKE_TIMEOUT_MS) {
      await vi.advanceTimersByTimeAsync(1);
      if (resetReceived(sim)) {
        resetDelayMs = Date.now() - abortAt;
        break;
      }
    }
    threads.rendererCostMs = 0;
    await vi.advanceTimersByTimeAsync(WORKER_HANDSHAKE_TIMEOUT_MS);
    expect(await stopping).toBeUndefined();

    expect(resetDelayMs).not.toBeNull();
    expect(resetDelayMs as number).toBeLessThanOrEqual(PROMPT_RESET_MS);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
  });

  it('still bounds a silent worker and reports that the Abort was not written', async () => {
    const sim = createGrblSimulator({ plannerBlocks: GRBL_PLANNER_BLOCKS, blockRetireMs: 4 });
    const threads = newThreads();
    await connectAndStartHosted(sim, threads);
    threads.workerStalledUntil = Number.POSITIVE_INFINITY;

    const stopping = useLaserStore
      .getState()
      .stopJob()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(WORKER_HANDSHAKE_TIMEOUT_MS + 100);

    expect(await stopping).toBeInstanceOf(Error);
    expect(resetReceived(sim)).toBe(false);
    expect(threads.terminated).toBe(true);
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'stop',
    });
  });
});
