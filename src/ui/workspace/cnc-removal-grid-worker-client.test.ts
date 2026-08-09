import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import {
  prepareCncCut3DSurfaceOffThread,
  prepareCncRemovalGridOffThread,
  prepareReliefHeightmapsOffThread,
  resetCncRemovalGridWorkerForTests,
} from './cnc-removal-grid-worker-client';
import type {
  CncRemovalGridWorkerRequest,
  CncRemovalGridWorkerResponse,
} from './cnc-removal-grid-worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<CncRemovalGridWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: CncRemovalGridWorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    if (!isCanvasCompilationBridgeConnection(message)) {
      this.posted.push(message as CncRemovalGridWorkerRequest);
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  respondGrid(grid: RemovalGrid | null): void {
    const request = this.posted.at(-1);
    if (request === undefined) throw new Error('removal-grid request missing');
    this.onmessage?.({
      data: { id: request.id, kind: 'grid', grid },
    } as MessageEvent<CncRemovalGridWorkerResponse>);
  }

  respondSurface(surface: ReliefSurfaceMeshWithNormals): void {
    const request = this.posted.at(-1);
    if (request === undefined) throw new Error('surface request missing');
    this.onmessage?.({
      data: { id: request.id, kind: 'surface', surface },
    } as MessageEvent<CncRemovalGridWorkerResponse>);
  }

  respondRelief(
    items: Extract<CncRemovalGridWorkerResponse, { kind: 'relief-heightmaps' }>['items'],
  ): void {
    const request = this.posted.findLast((candidate) => candidate.kind === 'relief-heightmaps');
    if (request === undefined) throw new Error('relief request missing');
    this.onmessage?.({
      data: { id: request.id, kind: 'relief-heightmaps', items },
    } as MessageEvent<CncRemovalGridWorkerResponse>);
  }

  respondError(id: number, message: string): void {
    this.onmessage?.({
      data: { id, kind: 'error', message },
    } as MessageEvent<CncRemovalGridWorkerResponse>);
  }
}

const GRID: RemovalGrid = {
  widthCells: 1,
  heightCells: 1,
  widthMm: 1,
  heightMm: 1,
  mmPerCell: 1,
  originX: 0,
  originY: 0,
  depth: new Float32Array([-1]),
  resolution: { requestedMmPerCell: 1, effectiveMmPerCell: 1, reason: null },
};
const SURFACE: ReliefSurfaceMeshWithNormals = {
  positions: new Float32Array([0, 0, -1]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array(),
  widthMm: 1,
  heightMm: 1,
};
const DEPTH_MAP = testReliefHeightfield({
  width: 1,
  height: 1,
  physicalWidthMm: 1,
  physicalHeightMm: 1,
  maxDepthMm: 1,
  samplesU8: [255],
});

beforeEach(() => {
  resetCncRemovalGridWorkerForTests();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  resetCncRemovalGridWorkerForTests();
  vi.unstubAllGlobals();
});

describe('CNC removal-grid worker client', () => {
  it('returns null rather than computing on the UI thread without Worker support', () => {
    vi.unstubAllGlobals();
    expect(prepareCncRemovalGridOffThread(request())).toBeNull();
    expect(prepareCncCut3DSurfaceOffThread(GRID)).toBeNull();
  });

  it('terminates stale work and starts the replacement on a fresh outer worker', async () => {
    const first = prepareCncRemovalGridOffThread(request());
    const firstWorker = FakeWorker.instances[0];
    if (first === null || firstWorker === undefined) throw new Error('first worker unavailable');

    const second = prepareCncRemovalGridOffThread({ ...request(), scrubFraction: 0.5 });
    if (second === null) throw new Error('replacement worker unavailable');

    await expect(first).rejects.toMatchObject({ name: 'CncRemovalGridSupersededError' });
    expect(firstWorker.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1];
    if (replacement === undefined) throw new Error('replacement worker missing');
    expect(replacement.posted).toHaveLength(1);
    replacement.respondGrid(GRID);
    await expect(second).resolves.toBe(GRID);
  });

  it('uses the same latest-only background lane for lazy Cut 3D surface preparation', async () => {
    const result = prepareCncCut3DSurfaceOffThread(GRID);
    const worker = FakeWorker.instances[0];
    if (result === null || worker === undefined) throw new Error('surface worker unavailable');
    expect(worker.posted).toEqual([{ id: 1, kind: 'surface', grid: GRID }]);
    worker.respondSurface(SURFACE);
    await expect(result).resolves.toBe(SURFACE);
  });

  it('waits for active relief cancellation before advancing queued current work', async () => {
    const controller = new AbortController();
    const first = prepareReliefHeightmapsOffThread(
      [{ taskId: 'stale', source: DEPTH_MAP, options: reliefOptions() }],
      controller.signal,
    );
    const firstWorker = FakeWorker.instances[0];
    if (first === null || firstWorker === undefined) throw new Error('relief worker unavailable');
    const second = prepareReliefHeightmapsOffThread([
      { taskId: 'current', source: DEPTH_MAP, options: reliefOptions() },
    ]);
    if (second === null) throw new Error('queued relief worker unavailable');

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(firstWorker.posted).toEqual([
      {
        id: 1,
        kind: 'relief-heightmaps',
        items: [{ taskId: 'stale', source: DEPTH_MAP, options: reliefOptions() }],
      },
      { id: 1, kind: 'cancel-relief' },
    ]);
    firstWorker.respondError(1, 'bounded compilation aborted');
    expect(firstWorker.posted.at(-1)).toEqual({
      id: 2,
      kind: 'relief-heightmaps',
      items: [{ taskId: 'current', source: DEPTH_MAP, options: reliefOptions() }],
    });
    firstWorker.respondRelief([
      {
        taskId: 'current',
        result: {
          kind: 'ok',
          heightmap: {
            widthCells: 1,
            heightCells: 1,
            widthMm: 1,
            heightMm: 1,
            mmPerCell: 1,
            depth: new Float32Array(1),
          },
          widthMm: 1,
          heightMm: 1,
        },
      },
    ]);
    await expect(second).resolves.toMatchObject([{ taskId: 'current', result: { kind: 'ok' } }]);
  });

  it('does not let stale removal-grid cleanup cancel an active relief preview', async () => {
    const gridController = new AbortController();
    const grid = prepareCncRemovalGridOffThread(request(), gridController.signal);
    const worker = FakeWorker.instances[0];
    if (grid === null || worker === undefined) throw new Error('grid worker unavailable');
    worker.respondGrid(GRID);
    await expect(grid).resolves.toBe(GRID);

    const relief = prepareReliefHeightmapsOffThread([
      { taskId: 'relief', source: DEPTH_MAP, options: reliefOptions() },
    ]);
    if (relief === null) throw new Error('relief worker unavailable');

    gridController.abort();

    expect(worker.terminated).toBe(false);
    worker.respondRelief([
      {
        taskId: 'relief',
        result: {
          kind: 'ok',
          heightmap: {
            widthCells: 1,
            heightCells: 1,
            widthMm: 1,
            heightMm: 1,
            mmPerCell: 1,
            depth: new Float32Array(1),
          },
          widthMm: 1,
          heightMm: 1,
        },
      },
    ]);
    await expect(relief).resolves.toMatchObject([{ taskId: 'relief', result: { kind: 'ok' } }]);
  });

  it('preserves queued relief work when active removal-grid work is cancelled', async () => {
    const controller = new AbortController();
    const grid = prepareCncRemovalGridOffThread(request(), controller.signal);
    const firstWorker = FakeWorker.instances[0];
    if (grid === null || firstWorker === undefined) throw new Error('grid worker unavailable');
    const relief = prepareReliefHeightmapsOffThread([
      { taskId: 'relief', source: DEPTH_MAP, options: reliefOptions() },
    ]);
    if (relief === null) throw new Error('relief worker unavailable');

    controller.abort();

    await expect(grid).rejects.toMatchObject({ name: 'AbortError' });
    expect(firstWorker.terminated).toBe(true);
    const replacement = FakeWorker.instances[1];
    if (replacement === undefined) throw new Error('replacement worker missing');
    expect(replacement.posted).toEqual([
      {
        id: 2,
        kind: 'relief-heightmaps',
        items: [{ taskId: 'relief', source: DEPTH_MAP, options: reliefOptions() }],
      },
    ]);
    replacement.respondRelief([
      {
        taskId: 'relief',
        result: {
          kind: 'ok',
          heightmap: {
            widthCells: 1,
            heightCells: 1,
            widthMm: 1,
            heightMm: 1,
            mmPerCell: 1,
            depth: new Float32Array(1),
          },
          widthMm: 1,
          heightMm: 1,
        },
      },
    ]);
    await expect(relief).resolves.toMatchObject([{ taskId: 'relief', result: { kind: 'ok' } }]);
  });

  it('does not let stale same-kind cleanup cancel a newer surface owner', async () => {
    const staleController = new AbortController();
    const stale = prepareCncCut3DSurfaceOffThread(GRID, staleController.signal);
    const staleWorker = FakeWorker.instances[0];
    if (stale === null || staleWorker === undefined) throw new Error('stale worker unavailable');

    const currentController = new AbortController();
    const current = prepareCncCut3DSurfaceOffThread(GRID, currentController.signal);
    if (current === null) throw new Error('current worker unavailable');
    await expect(stale).rejects.toMatchObject({ name: 'CncRemovalGridSupersededError' });
    const currentWorker = FakeWorker.instances[1];
    if (currentWorker === undefined) throw new Error('current worker missing');

    staleController.abort();

    expect(currentWorker.terminated).toBe(false);
    currentWorker.respondSurface(SURFACE);
    await expect(current).resolves.toBe(SURFACE);
  });
});

function reliefOptions() {
  return { targetWidthMm: 1, reliefDepthMm: 1, mmPerCell: 1 };
}

function request(): Omit<
  Extract<CncRemovalGridWorkerRequest, { readonly kind: 'grid' }>,
  'id' | 'kind'
> {
  return {
    device: DEFAULT_DEVICE_PROFILE,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    toolpath: {
      totalLength: 1,
      steps: [
        {
          kind: 'cut',
          color: '#000000',
          polyline: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
          ],
          length: 1,
          z: { from: -1, to: -1 },
        },
      ],
    },
    scrubFraction: 1,
  };
}
