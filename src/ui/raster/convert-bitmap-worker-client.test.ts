import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RasterImage } from '../../core/scene';
import {
  convertBitmapInWorker,
  resetConvertBitmapWorkerForTests,
} from './convert-bitmap-worker-client';
import type {
  ConvertBitmapWorkerRequest,
  ConvertBitmapWorkerResponse,
} from './convert-bitmap-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<ConvertBitmapWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request: ConvertBitmapWorkerRequest | undefined;
  transfer: Transferable[] | undefined;
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: ConvertBitmapWorkerRequest, transfer?: Transferable[]): void {
    this.request = request;
    this.transfer = transfer;
  }
  succeed(): void {
    if (this.request === undefined) throw new Error('missing request');
    this.onmessage?.({
      data: {
        id: this.request.id,
        kind: 'ok',
        raster: { id: this.request.rasterId } as RasterImage,
      },
    } as MessageEvent<ConvertBitmapWorkerResponse>);
  }
}

function latestWorker(): FakeWorker {
  const worker = FakeWorker.instances.at(-1);
  if (worker === undefined) throw new Error('missing worker');
  return worker;
}

function start(signal?: AbortSignal): Promise<RasterImage> {
  const result = convertBitmapInWorker([], {}, 'raster', signal);
  if (result === null) throw new Error('worker unavailable');
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  resetConvertBitmapWorkerForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('conversion request ownership', () => {
  it('transfers photo coordinates and still retires only the cancelled request', async () => {
    const controller = new AbortController();
    const photoRibbons = {
      points: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]),
      offsets: new Uint32Array([0, 4]),
    };
    const result = convertBitmapInWorker([], { photoRibbons }, 'photo', controller.signal);
    if (result === null) throw new Error('worker unavailable');
    const worker = latestWorker();
    expect(worker.transfer).toEqual([photoRibbons.points.buffer, photoRibbons.offsets.buffer]);
    const rejected = expect(result).rejects.toThrow(/cancelled/);
    controller.abort();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    const next = start();
    const replacement = latestWorker();
    worker.succeed();
    expect(replacement.terminate).not.toHaveBeenCalled();
    replacement.succeed();
    await expect(next).resolves.toEqual({ id: 'raster' });
  });
  it('terminates successful workers, clears timers, and keeps the signal out of the payload', async () => {
    const controller = new AbortController();
    const result = start(controller.signal);
    const worker = latestWorker();
    expect(worker.request).toEqual({
      id: expect.any(Number),
      rasterId: 'raster',
      vectors: [],
      options: {},
    });
    worker.succeed();
    expect(await result).toEqual({ id: 'raster' });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('aborts expensive work immediately and ignores a saved late reply after a retry starts', async () => {
    const controller = new AbortController();
    const result = start(controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const old = latestWorker();
    const lateReply = old.onmessage;
    controller.abort();
    await rejection;
    expect(old.terminate).toHaveBeenCalledOnce();
    const retry = start();
    const current = latestWorker();
    lateReply?.({
      data: { id: old.request?.id, kind: 'ok', raster: { id: 'stale' } },
    } as MessageEvent<ConvertBitmapWorkerResponse>);
    expect(current.terminate).not.toHaveBeenCalled();
    current.succeed();
    expect(await retry).toEqual({ id: 'raster' });
  });

  it('an already-aborted request neither creates a worker nor interrupts unrelated active work', async () => {
    const running = start();
    const worker = latestWorker();
    const controller = new AbortController();
    controller.abort();
    await expect(start(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.succeed();
    await running;
  });

  it('supersedes prior work and its deadline cannot retire the replacement', async () => {
    const first = start();
    const firstRejection = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const old = latestWorker();
    const lateError = old.onerror;
    await vi.advanceTimersByTimeAsync(10_000);
    const replacement = start();
    const current = latestWorker();
    await firstRejection;
    expect(old.terminate).toHaveBeenCalledOnce();
    lateError?.();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(current.terminate).not.toHaveBeenCalled();
    current.succeed();
    await replacement;
  });

  it.each(['timeout', 'error', 'messageerror', 'post'] as const)(
    'retires %s failures without leaving timers that can harm a retry',
    async (failure) => {
      if (failure === 'post')
        vi.spyOn(FakeWorker.prototype, 'postMessage').mockImplementationOnce(() => {
          throw new Error('post failed');
        });
      const result = start();
      const rejected = expect(result).rejects.toThrow();
      const old = latestWorker();
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(30_000);
      if (failure === 'error') old.onerror?.();
      if (failure === 'messageerror') old.onmessageerror?.();
      await rejected;
      expect(old.terminate).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      const retry = start();
      latestWorker().succeed();
      expect(await retry).toEqual({ id: 'raster' });
    },
  );
});
