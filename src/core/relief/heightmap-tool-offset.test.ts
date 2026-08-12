import { describe, expect, it } from 'vitest';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import {
  dilateHeightmapByTool,
  dilateHeightmapByToolWithMaskEvidence,
} from './heightmap-tool-offset';

const THREE_CELL_KERNEL: ToolKernel = {
  radiusCells: 1,
  offsets: [
    { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: 0 },
    { dx: 1, dy: 0, dz: 0 },
  ],
};

describe('dilateHeightmapByTool exclusion', () => {
  it('uses excluded stock top to keep the cutter envelope from crossing the mask', () => {
    const included: Heightmap = {
      widthCells: 3,
      heightCells: 1,
      mmPerCell: 1,
      depth: Float32Array.from([-5, 0, -5]),
    };
    const excluded: Heightmap = {
      ...included,
      inclusion: Uint8Array.from([1, 0, 1]),
    };

    expect([...dilateHeightmapByTool(included, THREE_CELL_KERNEL, 0)]).toEqual([0, 0, 0]);
    expect([...dilateHeightmapByTool(excluded, THREE_CELL_KERNEL, 0)]).toEqual([0, 0, 0]);
  });

  it('records included centers whose cutter kernel touches excluded stock', () => {
    const map: Heightmap = {
      widthCells: 4,
      heightCells: 1,
      mmPerCell: 1,
      depth: new Float32Array(4).fill(-2),
      inclusion: Uint8Array.from([1, 1, 0, 1]),
    };

    const result = dilateHeightmapByToolWithMaskEvidence(map, THREE_CELL_KERNEL, 0);

    expect([...result.tipDepth]).toEqual([-2, 0, 0, 0]);
    expect([...(result.touchesExcluded ?? [])]).toEqual([0, 1, 0, 1]);
  });

  it('stores a masked constraint on the stock-safe side of Float32 rounding', () => {
    const maskDz = 0.123456789;
    const map: Heightmap = {
      widthCells: 2,
      heightCells: 1,
      mmPerCell: 1,
      depth: Float32Array.from([-1, -1]),
      inclusion: Uint8Array.from([1, 0]),
    };
    const kernel: ToolKernel = {
      radiusCells: 1,
      offsets: [{ dx: 0, dy: 0, dz: 0 }],
      maskCellOffsets: [{ dx: 1, dy: 0, dz: maskDz }],
    };
    const exactConstraint = CNC_MASK_EMISSION_Z_CLEARANCE_MM - maskDz;

    expect(Math.fround(exactConstraint)).toBeLessThan(exactConstraint);
    expect(dilateHeightmapByTool(map, kernel, 0)[0]).toBeGreaterThanOrEqual(exactConstraint);
  });
});
