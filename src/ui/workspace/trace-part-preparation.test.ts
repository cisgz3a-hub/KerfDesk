import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type Polyline,
  type Scene,
  type TracedImage,
} from '../../core/scene';
import { withSubpathNesting } from '../../core/scene/subpath-nesting';
import { boundsFromColoredPaths } from '../../core/trace/trace-bounds';
import { prepareTracePartBounds, hasTracePartBounds } from '../../core/trace/trace-part-bounds';
import { cachedTracePartGroups, computeTracePartGroups } from '../../core/trace/trace-part-groups';
import { detachTracePartGeometry } from '../state/trace-part-geometry';
import { tracePathSubset } from '../state/trace-break-apart';
import { unpackColoredPath } from '../packed-project-transfer';
import { reserveWorkerMemory } from '../worker-memory-lane';
import { hitTracePart } from './trace-part-hit-test';
import {
  cancelTracePartPreparation,
  ensureTracePartSceneReady,
  isPreparedSingleTracePart,
  retryTracePartPreparation,
} from './trace-part-preparation';
import { useTracePartPreparationStatus } from './trace-part-preparation-store';
import {
  cancelTracePartWorker,
  prepareTracePartPathOffThread,
  TRACE_PART_WORKER_TIMEOUT_MS,
} from './trace-part-worker-client';
import type { TracePartWorkerRequest, TracePartWorkerResponse } from './trace-part-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<TracePartWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: TracePartWorkerRequest[] = [];
  transfer: Transferable[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: TracePartWorkerRequest, transfer: Transferable[]): void {
    this.posted.push(message);
    this.transfer = transfer;
  }
  terminate(): void {
    this.terminated = true;
  }
  result(): Extract<TracePartWorkerResponse, { kind: 'ok' }> {
    const request = this.posted.at(-1);
    if (request === undefined) throw new Error('No worker request.');
    const path = unpackColoredPath(request.path);
    return {
      id: request.id,
      kind: 'ok',
      bounds: prepareTracePartBounds(path),
      groups: request.mode === null ? null : computeTracePartGroups(path, request.mode),
    };
  }
  reply(): void {
    this.onmessage?.({ data: this.result() } as MessageEvent<TracePartWorkerResponse>);
  }
}

function square(x: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y: 0 },
      { x: x + size, y: 0 },
      { x: x + size, y: size },
      { x, y: size },
    ],
  };
}

function fixture(dense = true): { scene: Scene; object: TracedImage; path: ColoredPath } {
  const polylines: Polyline[] = [
    square(0, 100),
    {
      ...square(20, 60),
      points: square(20, 60).points.map((point) => ({ ...point, y: point.y + 20 })),
    },
  ];
  if (dense)
    for (let index = 0; index < 500; index += 1) polylines.push(square(200 + index * 20, 10));
  const path = withSubpathNesting({ color: '#000000', fillRule: 'evenodd', polylines }, [
    -1,
    0,
    ...polylines.slice(2).map(() => -1),
  ]);
  const object: TracedImage = {
    id: 'trace',
    kind: 'traced-image',
    source: 'source.png',
    paths: [path],
    bounds: boundsFromColoredPaths([path]),
    transform: IDENTITY_TRANSFORM,
    traceMode: 'filled-contours',
  };
  const scene: Scene = {
    objects: [object],
    layers: [createLayer({ id: 'fill', color: path.color, mode: 'fill' })],
  };
  return { scene, object, path };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  cancelTracePartPreparation();
  cancelTracePartWorker();
  FakeWorker.instances = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('trace-part worker preparation', () => {
  it('only carries cached groups to complete ordered shape subsets', () => {
    const { scene, path } = fixture(false);
    expect(ensureTracePartSceneReady(scene, 1)).toBe(true);
    expect(cachedTracePartGroups(tracePathSubset(path, [0, 1]), 'fill')).toEqual([[0, 1]]);
    expect(cachedTracePartGroups(tracePathSubset(path, [0]), 'fill')).toBeUndefined();
    expect(cachedTracePartGroups(tracePathSubset(path, [1, 0]), 'fill')).toBeUndefined();
  });
  it('prepares dense bounds and hole groups off-thread, then reuses them after extraction', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { scene, object, path } = fixture();
    const original = structuredClone(path);
    expect(ensureTracePartSceneReady(scene, 1)).toBe(false);
    expect(cachedTracePartGroups(path, 'fill')).toBeUndefined();
    expect(hasTracePartBounds(path)).toBe(false);
    expect(isPreparedSingleTracePart(object, scene.layers)).toBe(false);
    const worker = FakeWorker.instances[0];
    expect(worker?.transfer.length).toBeGreaterThan(0);
    expect(worker?.posted[0]).not.toHaveProperty('scene');
    worker?.reply();
    await settle();
    expect(worker?.terminated).toBe(true);
    expect(useTracePartPreparationStatus.getState().status).toBe('ready');
    expect(ensureTracePartSceneReady(scene, 1)).toBe(true);
    expect(cachedTracePartGroups(path, 'fill')?.[0]).toEqual([0, 1]);
    expect(hitTracePart(scene, { x: 10, y: 50 }, 0.1)?.subpathIndex).toBe(0);
    expect(hitTracePart(scene, { x: 50, y: 50 }, 0.1)).toBeNull();
    const split = detachTracePartGeometry(object, 0, 0, 'part', scene.layers);
    expect(split?.part.paths[0]?.polylines).toHaveLength(2);
    if (split?.remainder == null) throw new Error('Missing remainder.');
    const nextScene = { ...scene, objects: [split.remainder, split.part] };
    expect(ensureTracePartSceneReady(nextScene, 1)).toBe(true);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(isPreparedSingleTracePart(split.part, scene.layers)).toBe(true);
    expect(split.remainder.bounds).toEqual(boundsFromColoredPaths(split.remainder.paths));
    expect(path).toEqual(original);
  });

  it('prepares dense compatibility samples off-thread even with few canonical segments', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const base = fixture(false);
    const points = Array.from({ length: 20_000 }, (_, index) => {
      const angle = (index * 2 * Math.PI) / 20_000;
      return { x: 100 + 90 * Math.cos(angle), y: 100 + 90 * Math.sin(angle) };
    });
    const path: ColoredPath = {
      color: '#000000',
      polylines: [{ points, closed: true }],
      curves: [
        {
          start: { x: 190, y: 100 },
          closed: true,
          segments: [10, 190].map((x) => ({
            kind: 'elliptical-arc' as const,
            radiusX: 90,
            radiusY: 90,
            rotationDeg: 0,
            largeArc: false,
            sweep: true,
            to: { x, y: 100 },
          })),
        },
      ],
    };
    const object = { ...base.object, paths: [path] };
    const scene = { ...base.scene, objects: [object] };
    expect(isPreparedSingleTracePart(object, scene.layers)).toBe(false);
    expect(cachedTracePartGroups(path, 'fill')).toBeUndefined();
    expect(ensureTracePartSceneReady(scene, 1)).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(cachedTracePartGroups(path, 'fill')).toBeUndefined();
    FakeWorker.instances[0]?.reply();
    await settle();
    expect(ensureTracePartSceneReady(scene, 1)).toBe(true);
    expect(isPreparedSingleTracePart(object, scene.layers)).toBe(true);
    expect(cachedTracePartGroups(path, 'fill')).toEqual([[0]]);
  });

  it('discards a late reply after document replacement and never prepares its original path', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const first = fixture();
    ensureTracePartSceneReady(first.scene, 1);
    const stale = FakeWorker.instances[0];
    const staleHandler = stale?.onmessage;
    const result = stale?.result();
    const newest = fixture();
    ensureTracePartSceneReady(newest.scene, 2);
    expect(stale?.terminated).toBe(true);
    if (result !== undefined)
      staleHandler?.({ data: result } as MessageEvent<TracePartWorkerResponse>);
    await settle();
    expect(cachedTracePartGroups(first.path, 'fill')).toBeUndefined();
    expect(hasTracePartBounds(first.path)).toBe(false);
    expect(useTracePartPreparationStatus.getState().status).toBe('preparing');
    FakeWorker.instances[1]?.reply();
    await settle();
    expect(cachedTracePartGroups(newest.path, 'fill')).toBeDefined();
  });

  it('cancels active work when the editing mode ends', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { scene, path } = fixture();
    ensureTracePartSceneReady(scene, 1);
    cancelTracePartPreparation();
    await settle();
    expect(FakeWorker.instances[0]?.terminated).toBe(true);
    expect(useTracePartPreparationStatus.getState().status).toBe('idle');
    expect(cachedTracePartGroups(path, 'fill')).toBeUndefined();
  });

  it('never falls back to dense synchronous work when a worker is unavailable; small artwork remains usable', async () => {
    vi.stubGlobal('Worker', undefined);
    const dense = fixture();
    expect(ensureTracePartSceneReady(dense.scene, 1)).toBe(false);
    await settle();
    expect(useTracePartPreparationStatus.getState().status).toBe('error');
    expect(cachedTracePartGroups(dense.path, 'fill')).toBeUndefined();
    expect(ensureTracePartSceneReady(dense.scene, 1)).toBe(false);
    const small = fixture(false);
    expect(ensureTracePartSceneReady(small.scene, 2)).toBe(true);
    expect(cachedTracePartGroups(small.path, 'fill')).toEqual([[0, 1]]);
  });

  it('keeps fill and independent-stroke preparations separate when an operation changes', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const original = fixture();
    const object = { ...original.object, traceMode: 'centerline' as const };
    const lineScene = {
      ...original.scene,
      objects: [object],
      layers: [createLayer({ id: 'line', color: original.path.color, mode: 'line' })],
    };
    ensureTracePartSceneReady(lineScene, 1);
    FakeWorker.instances[0]?.reply();
    await settle();
    expect(cachedTracePartGroups(original.path, 'stroke')?.[0]).toEqual([0]);
    const fillScene = { ...lineScene, layers: original.scene.layers };
    expect(ensureTracePartSceneReady(fillScene, 1)).toBe(false);
    FakeWorker.instances[1]?.reply();
    await settle();
    expect(cachedTracePartGroups(original.path, 'fill')?.[0]).toEqual([0, 1]);
    expect(cachedTracePartGroups(original.path, 'stroke')?.[0]).toEqual([0]);
  });

  it.each(['error', 'messageerror', 'timeout'] as const)(
    'retires %s failures and permits an explicit retry',
    async (failure) => {
      vi.useFakeTimers();
      vi.stubGlobal('Worker', FakeWorker);
      const { scene } = fixture();
      ensureTracePartSceneReady(scene, 1);
      const worker = FakeWorker.instances[0];
      if (failure === 'error') worker?.onerror?.();
      else if (failure === 'messageerror') worker?.onmessageerror?.();
      else await vi.advanceTimersByTimeAsync(TRACE_PART_WORKER_TIMEOUT_MS);
      await settle();
      expect(worker?.terminated).toBe(true);
      expect(useTracePartPreparationStatus.getState().status).toBe('error');
      expect(ensureTracePartSceneReady(scene, 1)).toBe(false);
      expect(FakeWorker.instances).toHaveLength(1);
      retryTracePartPreparation();
      FakeWorker.instances[1]?.reply();
      await settle();
      expect(useTracePartPreparationStatus.getState().status).toBe('ready');
    },
  );

  it('does not construct or clone a queued worker after cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const release = reserveWorkerMemory(() => undefined);
    const { path } = fixture();
    const request = prepareTracePartPathOffThread(path, 'fill').catch((error: unknown) => error);
    expect(FakeWorker.instances).toHaveLength(0);
    cancelTracePartWorker();
    release();
    expect(await request).toBeInstanceOf(Error);
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('uses a worker when many individually small paths exceed the total preparation budget', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const base = fixture(false);
    const paths: ColoredPath[] = Array.from({ length: 500 }, (_, index) => ({
      color: '#000000',
      polylines: [square(index * 20, 10)],
    }));
    const scene = { ...base.scene, objects: [{ ...base.object, paths }] };
    expect(ensureTracePartSceneReady(scene, 1)).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(cachedTracePartGroups(paths[0] as ColoredPath, 'fill')).toBeUndefined();
    cancelTracePartPreparation();
    await settle();
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('reuses one worker for sequential paths and releases it when the whole preparation completes', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const first = fixture();
    const second = fixture();
    const scene = {
      ...first.scene,
      objects: [{ ...first.object, paths: [first.path, second.path] }],
    };
    expect(ensureTracePartSceneReady(scene, 1)).toBe(false);
    const worker = FakeWorker.instances[0];
    expect(worker?.posted).toHaveLength(1);
    worker?.reply();
    await settle();
    expect(worker?.terminated).toBe(false);
    expect(worker?.posted).toHaveLength(2);
    expect(FakeWorker.instances).toHaveLength(1);
    worker?.reply();
    await settle();
    expect(worker?.terminated).toBe(true);
    expect(useTracePartPreparationStatus.getState().status).toBe('ready');
    expect(cachedTracePartGroups(first.path, 'fill')).toBeDefined();
    expect(cachedTracePartGroups(second.path, 'fill')).toBeDefined();
  });

  it.each(['locked', 'hidden'] as const)(
    'does not block visible picks on a %s dense object',
    async (unavailable) => {
      vi.stubGlobal('Worker', FakeWorker);
      const dense = fixture();
      const small = fixture(false);
      const object = {
        ...dense.object,
        id: 'unavailable',
        ...(unavailable === 'locked' ? { locked: true } : {}),
      };
      const scene = {
        objects: [
          small.object,
          { ...object, paths: [{ ...dense.path, operationIds: ['hidden'] }] },
        ],
        layers: [
          ...small.scene.layers,
          { ...createLayer({ id: 'hidden', color: '#000000', mode: 'fill' }), visible: false },
        ],
      };
      expect(ensureTracePartSceneReady(scene, 1)).toBe(true);
      expect(FakeWorker.instances).toHaveLength(0);
      expect(hitTracePart(scene, { x: 10, y: 50 }, 0.1)?.objectId).toBe('trace');
      cancelTracePartPreparation();
      await settle();
    },
  );
});
