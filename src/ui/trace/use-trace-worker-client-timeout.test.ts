// Superseding unfinished work retires its synchronous worker; a healthy
// completed worker stays reusable. Request and timer ownership must survive
// late events from the retired instance.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

// Width varies per call so a test can tell WHICH request produced a response:
// the fake worker echoes the request's grid back in its result.
function largeImage(width: number): RawImageData {
  const h = 400;
  return { width, height: h, data: new Uint8ClampedArray(width * h * 4) };
}

function smallImage(): RawImageData {
  return { width: 2, height: 2, data: new Uint8ClampedArray(16) };
}

const traceOptions = {
  numberOfColors: 2,
  pathOmit: 0,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 0,
  blurDelta: 0,
  lineFilter: false,
  fixedPalette: ['#ffffff', '#000000'],
};

const ZERO_BOUNDS = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

// Mirrors TRACE_WORKER_TIMEOUT_MS in use-trace-worker-client.ts.
const WATCHDOG_BUDGET_MS = 30_000;

// Controlled compute duration. The replacement must finish after one interval
// instead of waiting for the superseded worker's interval first.
const WORKER_TRACE_MS = 20_000;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('traceImage supersede lifecycle (unfinished owner retired)', () => {
  it('rejects the superseded request and gives the newest one a fresh worker', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const workers: RespondingWorker[] = [];
    class RespondingWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      terminated = false;
      requests: TraceWorkerRequest[] = [];

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        this.requests.push(request);
        const response: TraceWorkerResponse = {
          id: request.id,
          kind: 'ok',
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          width: request.image.width,
          height: request.image.height,
        };
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
        });
      }

      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', RespondingWorker);
    try {
      const client = await import('./use-trace-worker-client');
      const first = client.traceImage(largeImage(401), traceOptions).catch((err: unknown) => err);
      const second = client.traceImage(largeImage(402), traceOptions);

      await vi.advanceTimersByTimeAsync(0);
      const firstError = await first;
      expect(firstError).toBeInstanceOf(Error);
      expect(client.isTraceRequestSuperseded(firstError)).toBe(true);
      // The old callback is attempted first; the newest caller must still see
      // only its own worker's grid.
      await expect(second).resolves.toEqual({
        paths: [],
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        width: 402,
        height: 400,
      });
      expect(workers).toHaveLength(2);
      expect(workers[0]?.terminated).toBe(true);
      expect(workers[1]?.terminated).toBe(false);
      expect(workers.map((worker) => worker.requests.length)).toEqual([1, 1]);

      // The superseded request's 30s timer was cleared on rejection and the
      // completed request's on resolve — neither may later kill the worker.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(workers[1]?.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a superseded small request through the inline fallback', async () => {
    vi.resetModules();
    const workers: SmallRespondingWorker[] = [];
    class SmallRespondingWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        const response: TraceWorkerResponse = {
          id: request.id,
          kind: 'ok',
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          width: request.image.width,
          height: request.image.height,
        };
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
        });
      }

      terminate(): void {
        /* lifecycle is asserted by the first test */
      }
    }
    vi.stubGlobal('Worker', SmallRespondingWorker);

    const client = await import('./use-trace-worker-client');
    const first = client.traceImage(smallImage(), traceOptions).catch((error: unknown) => error);
    const second = client.traceImage(smallImage(), traceOptions);

    // A superseded rejection surfaces as-is: retrying inline would run a full
    // synchronous main-thread trace for a result nobody wants anymore.
    expect(client.isTraceRequestSuperseded(await first)).toBe(true);
    await expect(second).resolves.toEqual({
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      width: 2,
      height: 2,
    });
    expect(workers).toHaveLength(2);
  });
});

// The current request retains its compute budget without waiting for old work.
describe('traceImage watchdog measures compute time, not queue time', () => {
  it('completes the newest request in one compute interval while retiring stale work', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const workers: SerialTraceWorker[] = [];
    // Models the real worker's message loop: queued messages are dispatched one
    // at a time, so a request is acked 'started' only once it reaches the head.
    class SerialTraceWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      terminated = false;
      readonly queued: TraceWorkerRequest[] = [];
      isBusy = false;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        this.queued.push(request);
        this.runHeadOfQueue();
      }

      terminate(): void {
        this.terminated = true;
      }

      // The double owns the whole response shape, so the cast only re-labels a
      // plain object as the MessageEvent the client's handler destructures.
      emit(response: TraceWorkerResponse): void {
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
        });
      }

      runHeadOfQueue(): void {
        if (this.isBusy) return;
        const next = this.queued.shift();
        if (next === undefined) return;
        this.isBusy = true;
        this.emit({ id: next.id, kind: 'started' });
        setTimeout(() => {
          this.emit({
            id: next.id,
            kind: 'ok',
            paths: [],
            bounds: ZERO_BOUNDS,
            width: next.image.width,
            height: next.image.height,
          });
          this.isBusy = false;
          this.runHeadOfQueue();
        }, WORKER_TRACE_MS);
      }
    }
    vi.stubGlobal('Worker', SerialTraceWorker);
    try {
      const client = await import('./use-trace-worker-client');
      const superseded = client
        .traceImage(largeImage(401), traceOptions)
        .catch((error: unknown) => error);
      // Settled eagerly so a rejection never escapes as an unhandled promise
      // while the fake clock runs, and so the failure diff names the message.
      const newest = client.traceImage(largeImage(402), traceOptions).then(
        (result) => ({ kind: 'ok' as const, result }),
        (error: unknown) => ({
          kind: 'failed' as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      );

      // The replacement starts immediately, so one interval suffices.
      await vi.advanceTimersByTimeAsync(WORKER_TRACE_MS + 1);

      expect(client.isTraceRequestSuperseded(await superseded)).toBe(true);
      expect(await newest).toEqual({
        kind: 'ok',
        result: { paths: [], bounds: ZERO_BOUNDS, width: 402, height: 400 },
      });
      expect(workers).toHaveLength(2);
      expect(workers[0]?.terminated).toBe(true);
      expect(workers[1]?.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('still terminates a worker that acks a request and then hangs on it', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const workers: AckThenHangWorker[] = [];
    class AckThenHangWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      terminated = false;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        queueMicrotask(() => {
          // Same re-labelling cast as above; the double authors the response.
          this.onmessage?.({
            data: { id: request.id, kind: 'started' },
          } as MessageEvent<TraceWorkerResponse>);
        });
        // ...and then never finishes the trace: a genuine hang.
      }

      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', AckThenHangWorker);
    try {
      const client = await import('./use-trace-worker-client');
      const outcome = client.traceImage(largeImage(401), traceOptions).then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );

      await vi.advanceTimersByTimeAsync(WATCHDOG_BUDGET_MS + 1);

      expect(await outcome).toBe('Trace worker timed out');
      expect(workers[0]?.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
