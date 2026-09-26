// downsampleRemovalGrid (ADR-103 G4): block-deepest reduction, scale
// preservation, and the no-op fast path.

import { describe, expect, it } from 'vitest';
import { partialCellSize } from '../grid';
import { createRemovalGrid, type RemovalGrid } from './removal-grid';
import { downsampleRemovalGrid } from './removal-grid-display';

function gridWithDepths(widthMm: number, heightMm: number, mmPerCell: number): RemovalGrid {
  const result = createRemovalGrid({ originX: 0, originY: 0, widthMm, heightMm, mmPerCell });
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

describe('downsampleRemovalGrid', () => {
  it('returns the same grid when it already fits the budget', () => {
    const grid = gridWithDepths(10, 10, 1); // 10×10 cells
    expect(downsampleRemovalGrid(grid, 16)).toBe(grid);
  });

  it('keeps the deepest value of each source block', () => {
    const grid = gridWithDepths(4, 4, 1); // 4×4 cells
    grid.depth[0] = -1; // block (0,0)
    grid.depth[5] = -3; // also block (0,0) at factor 2
    grid.depth[10] = -2; // block (1,1)
    const small = downsampleRemovalGrid(grid, 2);
    expect(small.widthCells).toBe(2);
    expect(small.heightCells).toBe(2);
    expect(small.mmPerCell).toBe(2);
    expect(small.depth[0]).toBe(-3);
    expect(small.depth[3]).toBe(-2);
    expect(small.depth[1]).toBe(0);
    expect(small.resolution).toEqual({
      requestedMmPerCell: 1,
      effectiveMmPerCell: 2,
      reason: 'display-mesh-cell-budget',
    });
  });

  it('covers the whole footprint when dimensions do not divide evenly', () => {
    const grid = gridWithDepths(5, 3, 1); // 5×3 cells
    const last = grid.depth.length - 1;
    grid.depth[last] = -4;
    const small = downsampleRemovalGrid(grid, 2);
    // factor 3 → 2×1 cells; the far corner's block still carries −4.
    expect(small.widthCells).toBe(2);
    expect(small.heightCells).toBe(1);
    expect(small.depth[1]).toBe(-4);
  });

  it('preserves exact extents and partial terminal cells while coarsening', () => {
    const grid = gridWithDepths(1, 0.5, 0.3);
    grid.depth[grid.depth.length - 1] = -4;

    const small = downsampleRemovalGrid(grid, 2);

    expect(small).toMatchObject({
      widthCells: 2,
      heightCells: 1,
      widthMm: 1,
      heightMm: 0.5,
      mmPerCell: 0.6,
    });
    expect(partialCellSize(small, 'x', 1)).toBeCloseTo(0.4, 10);
    expect(partialCellSize(small, 'y', 0)).toBeCloseTo(0.5, 10);
    expect(small.depth[1]).toBe(-4);
  });

  it('keeps a coarse output cell excluded when any source coverage is excluded', () => {
    const grid: RemovalGrid = {
      ...gridWithDepths(4, 2, 1),
      depth: Float32Array.from([-5, -4, -3, -2, -1, -1, -1, -1]),
      inclusion: Uint8Array.from([0, 0, 1, 0, 0, 0, 0, 0]),
    };

    const small = downsampleRemovalGrid(grid, 2);

    expect([...small.depth]).toEqual([0, 0]);
    expect([...small.inclusion!]).toEqual([0, 0]);
  });

  describe('material left inside a cut (ADR-425)', () => {
    // 12 × 3 cells at 1 mm, downsampled by 3: one output row of four cells.
    function groove(depthAt: (col: number) => number): RemovalGrid {
      const grid = gridWithDepths(12, 3, 1);
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 12; col += 1) grid.depth[row * 12 + col] = depthAt(col);
      }
      return grid;
    }

    it('keeps a tab shorter than two display cells standing in its groove', () => {
      // Floor at -6 with a 4 mm tab at -3 from x = 1 to 5: no output block is
      // all tab, so deepest-only pooling showed an unbroken groove.
      const grid = groove((col) => (col >= 1 && col < 5 ? -3 : -6));
      const small = downsampleRemovalGrid(grid, 4);
      expect([...small.depth]).toEqual([-3, -3, -6, -6]);
    });

    it('still shows a thin cut in uncut stock at its full depth', () => {
      const grid = groove((col) => (col === 4 ? -2 : 0));
      const small = downsampleRemovalGrid(grid, 4);
      expect([...small.depth]).toEqual([0, -2, 0, 0]);
    });

    it('keeps sloped blocks at their deepest point', () => {
      const grid = groove((col) => -1 - col * 0.5);
      const small = downsampleRemovalGrid(grid, 4);
      expect([...small.depth]).toEqual([-2, -3.5, -5, -6.5]);
    });

    it('breaks an even split toward the deeper level', () => {
      const grid = gridWithDepths(2, 2, 1);
      grid.depth.set([-3, -6, -3, -6]);
      expect([...downsampleRemovalGrid(grid, 1).depth]).toEqual([-6]);
    });
  });
});
