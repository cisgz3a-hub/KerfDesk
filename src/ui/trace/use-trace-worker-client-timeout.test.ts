import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RawImageData } from '../../core/trace';
import type { TraceWorkerResponse } from './trace-worker';

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

describe('traceImage worker timeout sibling rejection', () => {
  it('rejects sibling pending requests when a timed-out worker is retired', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    let terminated = 0;
    class HungWorker {
      onmessage: ((e: MessageEvent<TraceWorkerResponse>) => void) | null = null;
      onerror: (() => void) | null = null;

      postMessage(): void {
        /* hung - intentionally never responds */
      }

      terminate(): void {
        terminated += 1;
      }
    }
    vi.stubGlobal('Worker', HungWorker);
    try {
      const client = await import('./use-trace-worker-client');
      const first = client.traceImage(largeImage(), traceOptions).catch((err: unknown) => err);
      await vi.advanceTimersByTimeAsync(100);
      let secondRejected = false;
      const second = client.traceImage(largeImage(), traceOptions).catch((err: unknown) => {
        secondRejected = true;
        return err;
      });

      await vi.advanceTimersByTimeAsync(29_900);
      const firstError = await first;
      expect(firstError).toBeInstanceOf(Error);
      expect((firstError as Error).message).toContain('timed out');
      await Promise.resolve();
      try {
        expect(secondRejected).toBe(true);
      } finally {
        if (!secondRejected) {
          await vi.advanceTimersByTimeAsync(30_000);
        }
        await second;
      }
      expect(terminated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
