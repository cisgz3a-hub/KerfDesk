// A packed worker result (trace-result-transfer.ts) is rebuilt in slices on
// the UI thread: the request resolves with the paths the worker traced, the
// browser gets turns while a dense result is rebuilt, and a newer request
// supersedes one still unpacking without retiring its idle worker.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColoredPath } from '../../core/scene';
import { TRACE_PRESETS, type RawImageData } from '../../core/trace';
import type { TraceWorkerRequest, TraceWorkerResponse } from './trace-worker';
import { packTracePaths } from './trace-result-transfer';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const IMAGE: RawImageData = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) };

function densePaths(): ColoredPath[] {
  const points = Array.from({ length: 60_000 }, (_, index) => ({ x: index, y: -index }));
  return [{ color: '#000000', polylines: [{ points, closed: false }] }];
}

function packedWorker(paths: ColoredPath[], terminated: { count: number }) {
  return class PackedWorker {
    onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
    onerror: (() => void) | null = null;

    postMessage(request: TraceWorkerRequest): void {
      const packed = packTracePaths(paths);
      if (packed === null) throw new Error('fixture must pack');
      const response: TraceWorkerResponse = {
        id: request.id,
        kind: 'ok',
        packedPaths: structuredClone(packed),
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        width: request.image.width,
        height: request.image.height,
      };
      queueMicrotask(() => {
        this.onmessage?.({ data: response } as MessageEvent<TraceWorkerResponse>);
      });
    }

    terminate(): void {
      terminated.count += 1;
    }
  };
}

describe('packed worker results', () => {
  it('resolve with the traced paths and give the browser turns while unpacking', async () => {
    vi.resetModules();
    const paths = densePaths();
    vi.stubGlobal('Worker', packedWorker(paths, { count: 0 }));
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    // A clock that has always just passed the slice deadline: every
    // checkpoint hands the browser a turn.
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
    const client = await import('./use-trace-worker-client');

    const result = await client.traceImage(IMAGE, TRACE_PRESETS['Sharp']!);

    expect(result.paths).toEqual(paths);
    expect(result.paths).not.toBe(paths);
    expect(timeouts.mock.calls.filter(([, delay]) => delay === 0).length).toBeGreaterThan(1);
  });

  it('let a newer request supersede one still unpacking without retiring the worker', async () => {
    vi.resetModules();
    const terminated = { count: 0 };
    vi.stubGlobal('Worker', packedWorker(densePaths(), terminated));
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
    const client = await import('./use-trace-worker-client');

    const first = client.traceImage(IMAGE, TRACE_PRESETS['Sharp']!);
    // The result has arrived and unpacking has yielded its first slice.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = client.traceImage(IMAGE, TRACE_PRESETS['Sharp']!);

    await expect(first).rejects.toSatisfy(client.isTraceRequestSuperseded);
    await expect(second).resolves.toMatchObject({ width: 2, height: 2 });
    expect(terminated.count).toBe(0);
  });
});
