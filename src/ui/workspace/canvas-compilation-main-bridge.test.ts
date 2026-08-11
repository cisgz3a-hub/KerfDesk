import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canvasCompilationParallelWorkerCount,
  connectCanvasCompilationMainBridge,
  resetCanvasCompilationMainBridgeForTests,
} from './canvas-compilation-main-bridge';
import { canvasCompilationResultTransferables } from './canvas-compilation-worker-protocol';

class FakeOuterWorker {
  terminated = false;

  postMessage(): void {
    return;
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  resetCanvasCompilationMainBridgeForTests();
  vi.unstubAllGlobals();
});

describe('canvas compilation main bridge connection admission', () => {
  it('transfers ownership of grid and Cut 3D surface arrays between worker realms', () => {
    const depth = new Float32Array(4);
    const inclusion = new Uint8Array(4);
    const positions = new Float32Array(12);
    const indices = new Uint32Array(6);
    const normals = new Float32Array(12);

    expect(
      canvasCompilationResultTransferables({
        kind: 'cnc-removal-grid',
        output: {
          widthCells: 2,
          heightCells: 2,
          mmPerCell: 1,
          originX: 0,
          originY: 0,
          depth,
          inclusion,
          resolution: { requestedMmPerCell: 1, effectiveMmPerCell: 1, reason: null },
        },
      }),
    ).toEqual([depth.buffer, inclusion.buffer]);
    expect(
      canvasCompilationResultTransferables({
        kind: 'cnc-cut3d-surface',
        output: { positions, indices, normals, widthMm: 2, heightMm: 2 },
      }),
    ).toEqual([positions.buffer, indices.buffer, normals.buffer]);
  });

  it.each([
    [undefined, 2],
    [Number.NaN, 2],
    [Number.POSITIVE_INFINITY, 2],
    [1, 2],
    [3.9, 2],
    [4, 3],
    [16, 3],
  ] as const)('selects %s hardware threads as %s bounded parallel lanes', (threads, expected) => {
    expect(canvasCompilationParallelWorkerCount(threads)).toBe(expected);
    expect(canvasCompilationParallelWorkerCount(threads) + 1).toBeLessThanOrEqual(4);
  });

  it('admits the five production outer sources and terminates a sixth', () => {
    const admitted = Array.from({ length: 5 }, () => new FakeOuterWorker());
    for (const worker of admitted) connectCanvasCompilationMainBridge(worker);
    const rejected = new FakeOuterWorker();

    expect(() => connectCanvasCompilationMainBridge(rejected)).toThrow('source capacity');
    expect(rejected.terminated).toBe(true);
    expect(admitted.every((worker) => !worker.terminated)).toBe(true);
  });

  it('terminates a newly-created outer worker when MessageChannel is unavailable', () => {
    vi.stubGlobal('MessageChannel', undefined);
    const worker = new FakeOuterWorker();

    expect(() => connectCanvasCompilationMainBridge(worker)).toThrow('bridge unavailable');
    expect(worker.terminated).toBe(true);
  });
});
