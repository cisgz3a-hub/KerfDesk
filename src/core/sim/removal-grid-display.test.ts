// downsampleRemovalGrid (ADR-103 G4): block-deepest reduction, scale
// preservation, and the no-op fast path.

import { describe, expect, it } from 'vitest';
import { createRemovalGrid } from './removal-grid';
import { downsampleRemovalGrid } from './removal-grid-display';

function gridWithDepths(widthMm: number, heightMm: number, mmPerCell: number) {
  return createRemovalGrid({ originX: 0, originY: 0, widthMm, heightMm, mmPerCell });
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
});
