import { describe, expect, it } from 'vitest';
import { CNC_MASK_EMISSION_Z_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import { kernelForTool, type ToolKernel } from '../sim';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import {
  dilateHeightmapByTool,
  dilateHeightmapByToolWithMaskEvidence,
} from './heightmap-tool-offset';

const FLAT_TOOL: CncTool = { id: 'flat', name: 'flat', kind: 'end-mill', diameterMm: 2 };
const THREE_CELL_KERNEL_BASE = kernelForTool(FLAT_TOOL, 1);
const THREE_CELL_KERNEL: ToolKernel = {
  ...THREE_CELL_KERNEL_BASE,
  maskCellOffsets: THREE_CELL_KERNEL_BASE.offsets,
  maskCellCandidateSpanCells: THREE_CELL_KERNEL_BASE.radiusCells,
  maskSweepCellOffsets: THREE_CELL_KERNEL_BASE.offsets,
  maskSweepCandidateSpanCells: THREE_CELL_KERNEL_BASE.radiusCells,
  maskPathUncertaintyMm: 0,
  maskSweepPathUncertaintyMm: 0,
};

describe('dilateHeightmapByTool exclusion', () => {
  it('uses excluded stock top to keep the cutter envelope from crossing the mask', () => {
    const included: Heightmap = {
      widthCells: 3,
      heightCells: 1,
      widthMm: 3,
      heightMm: 1,
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
      widthMm: 4,
      heightMm: 1,
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
      widthMm: 2,
      heightMm: 1,
      mmPerCell: 1,
      depth: Float32Array.from([-1, -1]),
      inclusion: Uint8Array.from([1, 0]),
    };
    const base = kernelForTool(FLAT_TOOL, 1);
    const kernel: ToolKernel = {
      ...base,
      offsets: [{ dx: 0, dy: 0, dz: 0 }],
      maskCellOffsets: [{ dx: 1, dy: 0, dz: maskDz }],
    };
    const exactConstraint = CNC_MASK_EMISSION_Z_CLEARANCE_MM - maskDz;

    expect(Math.fround(exactConstraint)).toBeLessThan(exactConstraint);
    expect(dilateHeightmapByTool(map, kernel, 0)[0]).toBeGreaterThanOrEqual(exactConstraint);
  });
});

describe('dilateHeightmapByTool exact rows (ADR-412)', () => {
  it('refines only the requested rows and keeps the sampled lattice elsewhere', () => {
    const widthCells = 8;
    const heightCells = 6;
    const depth = new Float32Array(widthCells * heightCells);
    for (let j = 0; j < heightCells; j += 1) {
      for (let i = 0; i < widthCells; i += 1) depth[j * widthCells + i] = -3 + 0.9 * i;
    }
    const map: Heightmap = {
      widthCells,
      heightCells,
      widthMm: widthCells,
      heightMm: heightCells,
      mmPerCell: 1,
      depth: Float32Array.from(depth, (value) => Math.min(0, value)),
    };
    const ball: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 3 };
    const kernel = kernelForTool(ball, 1);
    const exact = dilateHeightmapByTool(map, kernel, 0);
    const lattice = dilateHeightmapByTool(map, kernel, 0, { betweenSamples: false });
    const exactRows = Uint8Array.from([0, 1, 0, 0, 1, 0]);
    const mixed = dilateHeightmapByTool(map, kernel, 0, { exactRows });

    expect([...exact].some((value, index) => value > (lattice[index] ?? 0))).toBe(true);
    for (let j = 0; j < heightCells; j += 1) {
      const expected = exactRows[j] === 1 ? exact : lattice;
      for (let i = 0; i < widthCells; i += 1) {
        expect(mixed[j * widthCells + i]).toBe(expected[j * widthCells + i]);
      }
    }
  });
});
