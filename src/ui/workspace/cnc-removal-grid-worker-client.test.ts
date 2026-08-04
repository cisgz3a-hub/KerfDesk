import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { RemovalGrid } from '../../core/sim';
import { isCanvasCompilationBridgeConnection } from './canvas-compilation-worker-protocol';
import {
  prepareCncCut3DSurfaceOffThread,
  prepareCncRemovalGridOffThread,
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
}

const GRID: RemovalGrid = {
  widthCells: 1,
  heightCells: 1,
  mmPerCell: 1,
  originX: 0,
  originY: 0,
  depth: new Float32Array([-1]),
};
const SURFACE: ReliefSurfaceMeshWithNormals = {
  positions: new Float32Array([0, 0, -1]),
  normals: new Float32Array([0, 0, 1]),
  indices: new Uint32Array(),
  widthMm: 1,
  heightMm: 1,
};

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
});

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
