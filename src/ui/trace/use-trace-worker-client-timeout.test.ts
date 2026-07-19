import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

function largeImage(): RawImageData {
  const w = 401;
  const h = 400;
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
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

describe('traceImage single-flight worker lifecycle', () => {
  it('supersedes the active request and runs the newest request on a fresh worker', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const workers: LatestWinsWorker[] = [];
    class LatestWinsWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      terminated = false;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        if (workers[0] === this) return;
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
    vi.stubGlobal('Worker', LatestWinsWorker);
    try {
      const client = await import('./use-trace-worker-client');
      const first = client.traceImage(largeImage(), traceOptions).catch((err: unknown) => err);
      const second = client.traceImage(largeImage(), traceOptions);

      await vi.advanceTimersByTimeAsync(0);
      expect(workers).toHaveLength(2);
      const firstError = await first;
      expect(firstError).toBeInstanceOf(Error);
      expect(client.isTraceRequestSuperseded(firstError)).toBe(true);
      await expect(second).resolves.toEqual({
        paths: [],
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        width: 401,
        height: 400,
      });
      expect(workers[0]?.terminated).toBe(true);
      expect(workers[1]?.terminated).toBe(false);

      // The retired request's timer was cleared when it was superseded, so it
      // cannot later terminate the healthy replacement worker.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(workers[1]?.terminated).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not retry a superseded small request through the inline fallback', async () => {
    vi.resetModules();
    const workers: SmallLatestWinsWorker[] = [];
    class SmallLatestWinsWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        if (workers[0] === this) return;
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
    vi.stubGlobal('Worker', SmallLatestWinsWorker);

    const client = await import('./use-trace-worker-client');
    const first = client.traceImage(smallImage(), traceOptions).catch((error: unknown) => error);
    const second = client.traceImage(smallImage(), traceOptions);

    expect(client.isTraceRequestSuperseded(await first)).toBe(true);
    await expect(second).resolves.toEqual({
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      width: 2,
      height: 2,
    });
  });
});
