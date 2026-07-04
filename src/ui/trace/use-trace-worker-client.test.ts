// Smoke test for the inline-fallback path. Vitest's environment doesn't
// host the production worker bundle resolution Vite injects at build
// time, so the fallback path IS
// exercised: ensureWorker() throws on the URL construction and
// returns null, traceImage() then runs traceImageToColoredPaths
// inline. This test verifies that fallback path returns the expected
// shape (paths + bounds) without crashing.
//
// The worker path is covered at runtime in dev / Cloudflare builds.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RawImageData } from '../../core/trace';
import { canTraceInline, traceImage } from './use-trace-worker-client';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';

// Build a tiny synthetic image — single black pixel surrounded by
// white. Just enough that imagetracerjs has *something* to trace,
// without paying the full lazy-load cost on every test.
function tinyImage(): RawImageData {
  const w = 4;
  const h = 4;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p += 1) {
    const i = p * 4;
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  // One black pixel in the middle.
  const centre = (1 * w + 1) * 4;
  data[centre] = 0;
  data[centre + 1] = 0;
  data[centre + 2] = 0;
  return { width: w, height: h, data };
}

function largeImage(): RawImageData {
  const w = 401;
  const h = 400;
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
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

describe('traceImage (worker client with inline fallback)', () => {
  it('uses Vite-recognized inline worker construction for production large traces', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/ui/trace/use-trace-worker-client.ts'),
      'utf8',
    );
    const compact = source.replace(/\s+/g, ' ');

    expect(compact).toMatch(
      /new Worker\(new URL\('\.\/trace-worker\.ts', import\.meta\.url\), \{ type: 'module',? \}\)/,
    );
    expect(compact).not.toContain(
      "const workerUrl = new URL('./trace-worker.ts', import.meta.url); workerInstance = new Worker(workerUrl",
    );
  });

  it('allows inline fallback only for bounded images', () => {
    expect(canTraceInline({ width: 400, height: 400 })).toBe(true);
    expect(canTraceInline({ width: 401, height: 400 })).toBe(false);
  });

  it('returns paths + bounds when Worker is unavailable', async () => {
    const result = await traceImage(tinyImage(), traceOptions);
    expect(result).toHaveProperty('paths');
    expect(result).toHaveProperty('bounds');
    expect(Array.isArray(result.paths)).toBe(true);
    // Bounds must be finite numbers — no NaN / Infinity leaking
    // out from a no-result trace.
    expect(Number.isFinite(result.bounds.minX)).toBe(true);
    expect(Number.isFinite(result.bounds.maxY)).toBe(true);
  });

  it('keeps the worker alive after one request returns a trace error', async () => {
    vi.resetModules();
    const workers: FakeTraceWorker[] = [];
    class FakeTraceWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      terminated = false;
      postCount = 0;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        this.postCount += 1;
        const response: TraceWorkerResponse =
          this.postCount === 1
            ? { id: request.id, kind: 'error', message: 'decode failed' }
            : {
                id: request.id,
                kind: 'ok',
                paths: [],
                bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
              };
        queueMicrotask(() => {
          this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
        });
      }

      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', FakeTraceWorker);

    const client = await import('./use-trace-worker-client');

    await expect(client.traceImage(largeImage(), traceOptions)).rejects.toThrow('decode failed');
    await expect(client.traceImage(largeImage(), traceOptions)).resolves.toEqual({
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    });
    expect(workers).toHaveLength(1);
    expect(workers[0]?.postCount).toBe(2);
    expect(workers[0]?.terminated).toBe(false);
  });

  it('retries worker construction after a fatal worker runtime error', async () => {
    vi.resetModules();
    const workers: FatalThenHealthyWorker[] = [];
    class FatalThenHealthyWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      terminated = false;

      constructor() {
        workers.push(this);
      }

      postMessage(request: TraceWorkerRequest): void {
        const response: TraceWorkerResponse = {
          id: request.id,
          kind: 'ok',
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
        };
        queueMicrotask(() => {
          if (workers[0] === this) {
            this.onerror?.();
            return;
          }
          this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
        });
      }

      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', FatalThenHealthyWorker);

    const client = await import('./use-trace-worker-client');

    await expect(client.traceImage(largeImage(), traceOptions)).rejects.toThrow(
      'Trace worker errored',
    );
    await expect(client.traceImage(largeImage(), traceOptions)).resolves.toEqual({
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    });
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    expect(workers[1]?.terminated).toBe(false);
  });

  it('rejects and retires the worker when postMessage throws synchronously', async () => {
    vi.resetModules();
    let constructed = 0;
    let terminated = 0;
    class ThrowingPostMessageWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        constructed += 1;
      }

      postMessage(): void {
        throw new Error('structured clone failed');
      }

      terminate(): void {
        terminated += 1;
      }
    }
    vi.stubGlobal('Worker', ThrowingPostMessageWorker);

    const client = await import('./use-trace-worker-client');

    await expect(client.traceImage(largeImage(), traceOptions)).rejects.toThrow(
      'postMessage failed',
    );
    expect(constructed).toBe(1);
    expect(terminated).toBe(1);

    await expect(client.traceImage(largeImage(), traceOptions)).rejects.toThrow(
      'postMessage failed',
    );
    expect(constructed).toBe(2);
    expect(terminated).toBe(2);
  });
});

describe('traceImage worker timeout (P2-A)', () => {
  it('rejects and terminates a worker that never responds', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let terminated = 0;
    let constructed = 0;
    class HungWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        constructed += 1;
      }
      postMessage(): void {
        /* hung — intentionally never responds */
      }
      terminate(): void {
        terminated += 1;
      }
    }
    vi.stubGlobal('Worker', HungWorker);
    try {
      const client = await import('./use-trace-worker-client');
      // Large image (> 160k px) so a failure cannot fall back inline — the
      // timeout must surface as a rejection.
      const rejection = expect(client.traceImage(largeImage(), traceOptions)).rejects.toThrow(
        'timed out',
      );
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
      expect(terminated).toBe(1);

      // The retired worker is replaced on the next trace.
      const next = client.traceImage(largeImage(), traceOptions).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(30_000);
      await next;
      expect(constructed).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
