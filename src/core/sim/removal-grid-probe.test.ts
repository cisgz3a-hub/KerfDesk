import { describe, expect, it } from 'vitest';
import type { RemovalGrid } from './removal-grid';
import { probeRemovalGrid } from './removal-grid-probe';

// 3x2 cells of 10mm each, min corner at (100, 200). Cell (1,0) is 2mm deep,
// cell (2,1) is 5mm deep, the rest untouched.
function grid(): RemovalGrid {
  const depth = new Float32Array(6);
  depth[1] = -2;
  depth[5] = -5;
  return {
    widthCells: 3,
    heightCells: 2,
    mmPerCell: 10,
    originX: 100,
    originY: 200,
    depth,
  };
}

describe('probeRemovalGrid', () => {
  it('reads the depth of the cell containing the point', () => {
    expect(probeRemovalGrid(grid(), { x: 115, y: 205 })).toEqual({ kind: 'inside', depthMm: -2 });
    expect(probeRemovalGrid(grid(), { x: 125, y: 215 })).toEqual({ kind: 'inside', depthMm: -5 });
  });

  it('reports untouched stock as zero, not as missing', () => {
    // Zero depth and "off the stock" are different facts; a readout that
    // conflated them would show 0.0mm while hovering past the board edge.
    expect(probeRemovalGrid(grid(), { x: 105, y: 205 })).toEqual({ kind: 'inside', depthMm: 0 });
  });

  it('returns the outside arm off every edge rather than throwing', () => {
    const g = grid();
    for (const point of [
      { x: 99, y: 205 },
      { x: 205, y: 205 },
      { x: 115, y: 199 },
      { x: 115, y: 260 },
    ]) {
      expect(probeRemovalGrid(g, point).kind).toBe('outside');
    }
  });

  it('includes the min corner and excludes the max corner', () => {
    // Half-open cells: the max corner belongs to the next cell along, which is
    // off the grid. Including it would read one cell past the buffer.
    expect(probeRemovalGrid(grid(), { x: 100, y: 200 }).kind).toBe('inside');
    expect(probeRemovalGrid(grid(), { x: 130, y: 220 }).kind).toBe('outside');
  });
});
