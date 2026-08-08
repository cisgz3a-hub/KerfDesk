import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type ReliefObject } from '../../core/scene';

const worker = vi.hoisted(() => ({
  prepare: vi.fn(),
}));

vi.mock('./cnc-removal-grid-worker-client', () => ({
  prepareReliefHeightmapsOffThread: worker.prepare,
  isCncRemovalGridSuperseded: () => false,
}));

import { resetReliefPreviewCachesForTests, scheduleReliefPreviews } from './draw-relief';

beforeEach(() => {
  worker.prepare.mockReset();
  resetReliefPreviewCachesForTests();
});

afterEach(() => {
  resetReliefPreviewCachesForTests();
  vi.useRealTimers();
});

describe('depth-map canvas preview scheduling', () => {
  it('aborts a replaced generation and ignores its stale completion', async () => {
    const first = deferred<ReadonlyArray<WorkerResult>>();
    const second = deferred<ReadonlyArray<WorkerResult>>();
    worker.prepare.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onReady = vi.fn();

    scheduleReliefPreviews([relief('first', 'AA==')], visibleLayers(), onReady);
    scheduleReliefPreviews([relief('second', '/w==')], visibleLayers(), onReady);

    expect(worker.prepare).toHaveBeenCalledTimes(2);
    const firstSignal = worker.prepare.mock.calls[0]?.[1] as AbortSignal | undefined;
    expect(firstSignal?.aborted).toBe(true);

    first.resolve([{ taskId: '0', result: { kind: 'error', reason: 'stale' } }]);
    await first.promise;
    await Promise.resolve();
    expect(onReady).not.toHaveBeenCalled();

    second.resolve([{ taskId: '0', result: { kind: 'error', reason: 'current' } }]);
    await second.promise;
    await Promise.resolve();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not resubmit an unchanged pending source', async () => {
    const pending = deferred<ReadonlyArray<WorkerResult>>();
    worker.prepare.mockReturnValue(pending.promise);
    const object = relief('same', 'AA==');

    scheduleReliefPreviews([object], visibleLayers());
    scheduleReliefPreviews([object], visibleLayers());

    expect(worker.prepare).toHaveBeenCalledTimes(1);
    pending.resolve([{ taskId: '0', result: { kind: 'error', reason: 'settled' } }]);
    await pending.promise;
    await Promise.resolve();
  });

  it('skips hidden layers and submits visible embedded sources one at a time', async () => {
    const first = deferred<ReadonlyArray<WorkerResult>>();
    const second = deferred<ReadonlyArray<WorkerResult>>();
    worker.prepare.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const objects = [relief('first', 'AA=='), relief('second', '/w==')];

    scheduleReliefPreviews(objects, hiddenLayers());
    expect(worker.prepare).not.toHaveBeenCalled();

    scheduleReliefPreviews(objects, visibleLayers());
    expect(worker.prepare.mock.calls[0]?.[0]).toHaveLength(1);
    first.resolve([{ taskId: '0', result: { kind: 'error', reason: 'terminal source error' } }]);
    await first.promise;
    await Promise.resolve();
    scheduleReliefPreviews(objects, visibleLayers());
    expect(worker.prepare).toHaveBeenCalledTimes(2);
    expect(worker.prepare.mock.calls[1]?.[0]).toHaveLength(1);
    second.resolve([{ taskId: '0', result: { kind: 'error', reason: 'settled' } }]);
    await second.promise;
    await Promise.resolve();
  });

  it('retries infrastructure rejection without poisoning the source cache', async () => {
    vi.useFakeTimers();
    try {
      const retry = deferred<ReadonlyArray<WorkerResult>>();
      worker.prepare.mockRejectedValueOnce(new Error('transient broker failure'));
      worker.prepare.mockReturnValueOnce(retry.promise);
      const onReady = vi.fn();
      const object = relief('retry', 'AA==');

      scheduleReliefPreviews([object], visibleLayers(), onReady);
      await Promise.resolve();
      await Promise.resolve();
      expect(onReady).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(onReady).toHaveBeenCalledOnce();

      scheduleReliefPreviews([object], visibleLayers(), onReady);
      expect(worker.prepare).toHaveBeenCalledTimes(2);
      retry.resolve([{ taskId: '0', result: { kind: 'error', reason: 'settled' } }]);
      await retry.promise;
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries when the preview worker is unavailable without poisoning the source cache', () => {
    worker.prepare.mockReturnValue(null);
    const object = relief('retry-unavailable', 'AA==');

    scheduleReliefPreviews([object], visibleLayers());
    expect(worker.prepare).toHaveBeenCalledOnce();
    scheduleReliefPreviews([object], visibleLayers());

    expect(worker.prepare).toHaveBeenCalledTimes(2);
  });
});

type WorkerResult = {
  readonly taskId: string;
  readonly result: { readonly kind: 'error'; readonly reason: string };
};

function relief(id: string, samplesBase64: string): ReliefObject {
  return {
    kind: 'relief',
    id,
    source: `${id}.png`,
    depthMap: {
      schemaVersion: 1,
      width: 1,
      height: 1,
      bitDepth: 8,
      samplesBase64,
      polarity: 'light-is-high',
    },
    targetWidthMm: 20,
    reliefDepthMm: 3,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
}

function visibleLayers() {
  return new Map([['#a0522d', createLayer({ id: 'relief', color: '#a0522d' })]]);
}

function hiddenLayers() {
  return new Map([
    ['#a0522d', { ...createLayer({ id: 'relief', color: '#a0522d' }), visible: false }],
  ]);
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
