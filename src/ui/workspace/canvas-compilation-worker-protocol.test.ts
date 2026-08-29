import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import {
  canvasCompilationResultTransferables,
  executeCanvasCompilationTask,
} from './canvas-compilation-worker-protocol';

const SOURCE = testReliefHeightfield({
  width: 2,
  height: 1,
  physicalWidthMm: 2,
  physicalHeightMm: 1,
  maxDepthMm: 5,
  samplesU8: [0, 255],
});

describe('canvas compilation relief task', () => {
  it('carries requested and effective preview resolution through the grid task result', () => {
    const result = executeCanvasCompilationTask({
      kind: 'cnc-removal-grid',
      device: createProject().device,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, widthMm: 300, heightMm: 10 },
      },
      toolpath: { steps: [], totalLength: 0 },
      scrubFraction: 1,
      jobOriginOffset: { x: 0, y: 0 },
    });

    if (result.kind !== 'cnc-removal-grid' || result.output === null) {
      throw new Error('expected bounded removal grid');
    }
    expect(result.output.resolution).toEqual({
      requestedMmPerCell: 0.2,
      effectiveMmPerCell: 0.3,
      reason: 'interactive-preview-cell-budget',
    });
    expect(canvasCompilationResultTransferables(result)).toEqual([result.output.depth.buffer]);
  });

  it('materializes through the real bounded-worker task registry and transfers ownership', () => {
    const result = executeCanvasCompilationTask({
      kind: 'relief-heightmap',
      source: SOURCE,
      options: { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
    });

    expect(result).toMatchObject({ kind: 'relief-heightmap', output: { kind: 'ok' } });
    if (result.kind !== 'relief-heightmap' || result.output.kind !== 'ok') return;
    expect([...result.output.heightmap.depth]).toEqual([-5, 0]);
    expect(canvasCompilationResultTransferables(result)).toEqual([
      result.output.heightmap.depth.buffer,
    ]);
  });

  it('transfers the exclusion map with the resolved depth buffer', () => {
    const source = testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 2,
      physicalHeightMm: 1,
      maxDepthMm: 5,
      samplesU8: [0, 255],
      inclusionMask: [255, 0],
    });
    const result = executeCanvasCompilationTask({
      kind: 'relief-heightmap',
      source,
      options: { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
    });

    if (result.kind !== 'relief-heightmap' || result.output.kind !== 'ok') {
      throw new Error('expected resolved heightfield');
    }
    expect(canvasCompilationResultTransferables(result)).toEqual([
      result.output.heightmap.depth.buffer,
      result.output.heightmap.inclusion?.buffer,
    ]);
  });
});
