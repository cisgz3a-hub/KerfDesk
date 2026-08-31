import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { createLayer, IDENTITY_TRANSFORM, type ReliefObject } from '../../core/scene';

const worker = vi.hoisted(() => ({
  prepare: vi.fn(),
}));
const raster = vi.hoisted(() => ({ drawPartialGridBitmapAtTransform: vi.fn() }));

vi.mock('./cnc-removal-grid-worker-client', () => ({
  prepareReliefHeightmapsOffThread: worker.prepare,
  isCncRemovalGridSuperseded: () => false,
}));

vi.mock('./draw-raster', () => ({
  drawPartialGridBitmapAtTransform: raster.drawPartialGridBitmapAtTransform,
}));

import {
  drawReliefObject,
  resetReliefPreviewCachesForTests,
  scheduleReliefPreviews,
} from './draw-relief';

beforeEach(() => {
  worker.prepare.mockReset();
  raster.drawPartialGridBitmapAtTransform.mockReset();
  resetReliefPreviewCachesForTests();
});

afterEach(() => {
  resetReliefPreviewCachesForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('renders a terminal materialization failure with its factual reason', async () => {
    const reason = 'Relief heightfield digest does not match its payload.';
    worker.prepare.mockResolvedValueOnce([{ taskId: '0', result: { kind: 'error', reason } }]);
    const object = relief('invalid', 'AA==');
    const onReady = vi.fn();

    scheduleReliefPreviews([object], visibleLayers(), onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    const ctx = failureContext();
    drawReliefObject(ctx as unknown as CanvasRenderingContext2D, object, visibleLayers(), {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    expect(ctx.strokeRect).toHaveBeenCalledOnce();
    expect(ctx.fillText).toHaveBeenCalledWith(`[!] Relief preview failed: ${reason}`, 6, 12);
    expect(raster.drawPartialGridBitmapAtTransform).not.toHaveBeenCalled();
  });

  it('caches a terminal failure without retrying the same source and options', async () => {
    const object = relief('invalid-cached', 'AA==');
    const onReady = vi.fn();
    worker.prepare.mockResolvedValueOnce([
      { taskId: '0', result: { kind: 'error', reason: 'terminal source error' } },
    ]);

    scheduleReliefPreviews([object], visibleLayers(), onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledOnce());
    scheduleReliefPreviews([object], visibleLayers(), onReady);

    expect(worker.prepare).toHaveBeenCalledOnce();
  });

  it('retries a terminal failure after preview options or source revision changes', async () => {
    worker.prepare
      .mockResolvedValueOnce([
        { taskId: '0', result: { kind: 'error', reason: 'first terminal error' } },
      ])
      .mockResolvedValueOnce([
        { taskId: '0', result: { kind: 'error', reason: 'second terminal error' } },
      ])
      .mockResolvedValueOnce([
        { taskId: '0', result: { kind: 'error', reason: 'third terminal error' } },
      ]);
    const original = relief('recover', 'AA==');
    const onReady = vi.fn();

    scheduleReliefPreviews([original], visibleLayers(), onReady);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    scheduleReliefPreviews(
      [{ ...original, reliefDepthMm: original.reliefDepthMm + 1 }],
      visibleLayers(),
      onReady,
    );
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(2));
    scheduleReliefPreviews(
      [
        {
          ...original,
          reliefSource: {
            ...original.reliefSource,
            revision: original.reliefSource.revision + 1,
          },
        },
      ],
      visibleLayers(),
      onReady,
    );
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledTimes(3));

    expect(worker.prepare).toHaveBeenCalledTimes(3);
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

  it('uses explicit operation visibility for both scheduling and drawing', () => {
    worker.prepare.mockReturnValue(null);
    const object = { ...relief('bound-hidden', 'AA=='), operationIds: ['hidden-operation'] };
    const layers = explicitlyHiddenOperationLayers();
    const ctx = failureContext();

    scheduleReliefPreviews([object], layers);
    drawReliefObject(ctx as unknown as CanvasRenderingContext2D, object, layers, {
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });

    expect(worker.prepare).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
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

  it('renders excluded heightfield cells as transparent canvas pixels', async () => {
    let pixels: Uint8ClampedArray | undefined;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`unexpected element ${tagName}`);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: (image: { readonly data: Uint8ClampedArray }) => {
            pixels = image.data;
          },
        }),
      } as unknown as HTMLCanvasElement;
    });
    worker.prepare.mockResolvedValueOnce([
      {
        taskId: '0',
        result: {
          kind: 'ok',
          heightmap: {
            widthCells: 2,
            heightCells: 1,
            widthMm: 2,
            heightMm: 1,
            mmPerCell: 1,
            depth: Float32Array.from([-3, -3]),
            inclusion: Uint8Array.from([1, 0]),
          },
          widthMm: 2,
          heightMm: 1,
        },
      },
    ]);

    scheduleReliefPreviews([relief('masked', 'AA==')], visibleLayers());
    await Promise.resolve();
    await Promise.resolve();

    expect(Array.from(pixels ?? [])).toEqual([64, 64, 64, 255, 64, 64, 64, 0]);
  });

  it('draws the bitmap with the object rotation, scale, and mirror transform', async () => {
    let bitmap: HTMLCanvasElement | undefined;
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName !== 'canvas') throw new Error(`unexpected element ${tagName}`);
      bitmap = {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: vi.fn(),
        }),
      } as unknown as HTMLCanvasElement;
      return bitmap;
    });
    worker.prepare.mockResolvedValueOnce([
      {
        taskId: '0',
        result: {
          kind: 'ok',
          heightmap: {
            widthCells: 1,
            heightCells: 1,
            widthMm: 20,
            heightMm: 20,
            mmPerCell: 20,
            depth: Float32Array.of(-1),
          },
          widthMm: 20,
          heightMm: 20,
        },
      },
    ]);
    const object: ReliefObject = {
      ...relief('placed', 'AA=='),
      transform: {
        ...IDENTITY_TRANSFORM,
        x: 17,
        y: 23,
        scaleX: -0.5,
        scaleY: 2,
        rotationDeg: 37,
        mirrorX: true,
        mirrorY: true,
      },
    };
    const view = { scale: 3, offsetX: 11, offsetY: 13 };

    scheduleReliefPreviews([object], visibleLayers());
    await Promise.resolve();
    await Promise.resolve();
    const ctx = { imageSmoothingEnabled: false } as unknown as CanvasRenderingContext2D;
    drawReliefObject(ctx, object, visibleLayers(), view);

    expect(raster.drawPartialGridBitmapAtTransform).toHaveBeenCalledWith(
      ctx,
      bitmap,
      expect.objectContaining({ widthMm: 20, heightMm: 20, mmPerCell: 20 }),
      object.bounds,
      object.transform,
      view,
    );
  });
});

type WorkerResult = {
  readonly taskId: string;
  readonly result: { readonly kind: 'error'; readonly reason: string };
};

type HeightfieldRelief = Extract<
  ReliefObject,
  { readonly reliefSource: { readonly kind: 'heightfield-v1' } }
>;

function relief(id: string, samplesBase64: string): HeightfieldRelief {
  return {
    kind: 'relief',
    id,
    source: `${id}.png`,
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 3,
      samplesU8: [samplesBase64 === '/w==' ? 255 : 0],
      provenance: { sourceName: `${id}.png` },
    }),
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

function explicitlyHiddenOperationLayers() {
  const colorFallback = createLayer({ id: 'color-fallback', color: '#a0522d' });
  const hiddenOperation = {
    ...createLayer({ id: 'hidden-operation', color: '#112233' }),
    visible: false,
  };
  return new Map([
    ['#a0522d', colorFallback],
    [hiddenOperation.id, hiddenOperation],
  ]);
}

function failureContext() {
  return {
    imageSmoothingEnabled: false,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: 'alphabetic',
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
  };
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
