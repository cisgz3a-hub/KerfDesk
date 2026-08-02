// Pins the supersede lifecycle of the shared trace worker: a newer request
// rejects the pending caller (TraceRequestSupersededError) but KEEPS the
// worker alive — the stale job's late response is dropped by request id.
// Terminating on supersede paid a cold worker spawn (plus the full unbundled
// module-graph reload in Vite dev) on nearly every 50-500ms preview trace
// while the user tuned sliders/presets.

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('traceImage supersede lifecycle (shared worker kept alive)', () => {
  it('rejects the superseded request but reuses the live worker for the newest one', async () => {
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
      // The stale job's response (401px grid) arrived first and must be
      // dropped by request id — the newest caller sees only its own result.
      await expect(second).resolves.toEqual({
        paths: [],
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        width: 402,
        height: 400,
      });
      // ONE worker total: superseding must not terminate-and-respawn. The
      // cold spawn + worker module-graph reload was the P1 preview cost.
      expect(workers).toHaveLength(1);
      expect(workers[0]?.terminated).toBe(false);
      expect(workers[0]?.requests).toHaveLength(2);

      // The superseded request's 30s timer was cleared on rejection and the
      // completed request's on resolve — neither may later kill the worker.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(workers[0]?.terminated).toBe(false);
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
    expect(workers).toHaveLength(1);
  });
});
