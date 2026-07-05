// RemovalGrid finite-guard invariants (D-S04-002): a non-finite dimension
// must fail closed to a well-formed minimal grid, never a NaN cell count or a
// zero-length depth buffer.

import { describe, expect, it } from 'vitest';
import { coarsenedCellSize, createRemovalGrid, MAX_GRID_CELLS } from './removal-grid';

describe('createRemovalGrid finite guards', () => {
  it('builds a valid grid for a finite spec', () => {
    const grid = createRemovalGrid({ originX: 0, originY: 0, widthMm: 10, heightMm: 5 });
    expect(grid.widthCells).toBeGreaterThan(0);
    expect(grid.heightCells).toBeGreaterThan(0);
    expect(grid.depth.length).toBe(grid.widthCells * grid.heightCells);
  });

  it('fails closed to a minimal grid on non-finite dimensions', () => {
    for (const spec of [
      { originX: 0, originY: 0, widthMm: Number.POSITIVE_INFINITY, heightMm: 5 },
      { originX: 0, originY: 0, widthMm: 10, heightMm: Number.NaN },
      { originX: Number.NaN, originY: 0, widthMm: Number.NaN, heightMm: Number.NaN },
      { originX: 0, originY: 0, widthMm: 10, heightMm: 5, mmPerCell: Number.POSITIVE_INFINITY },
    ]) {
      const grid = createRemovalGrid(spec);
      expect(Number.isFinite(grid.widthCells)).toBe(true);
      expect(Number.isFinite(grid.heightCells)).toBe(true);
      expect(Number.isFinite(grid.mmPerCell)).toBe(true);
      expect(grid.widthCells).toBeGreaterThanOrEqual(1);
      expect(grid.heightCells).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(grid.originX)).toBe(true);
      expect(Number.isFinite(grid.originY)).toBe(true);
      expect(grid.depth.length).toBe(grid.widthCells * grid.heightCells);
    }
  });

  it('clamps pathological finite dimensions so the grid stays well-formed (AF-CORE-005)', () => {
    // 1e308 * 1e308 overflows to Infinity; a plain finite guard let that poison
    // mmPerCell and the cell counts. The dimension cap keeps everything finite
    // and inside the cell budget.
    const grid = createRemovalGrid({ originX: 0, originY: 0, widthMm: 1e308, heightMm: 1e308 });
    expect(Number.isFinite(grid.mmPerCell)).toBe(true);
    expect(grid.mmPerCell).toBeGreaterThan(0);
    expect(Number.isFinite(grid.widthCells)).toBe(true);
    expect(Number.isFinite(grid.heightCells)).toBe(true);
    expect(grid.widthCells * grid.heightCells).toBeLessThanOrEqual(MAX_GRID_CELLS);
    expect(grid.depth.length).toBe(grid.widthCells * grid.heightCells);
  });
});

describe('coarsenedCellSize finite guards', () => {
  it('returns a finite positive cell size for non-finite inputs', () => {
    const size = coarsenedCellSize(Number.POSITIVE_INFINITY, Number.NaN, Number.NaN);
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeGreaterThan(0);
  });

  it('stays finite for pathological finite dimensions (no area overflow)', () => {
    const size = coarsenedCellSize(1e308, 1e308, 0.2);
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeGreaterThan(0);
  });
});
