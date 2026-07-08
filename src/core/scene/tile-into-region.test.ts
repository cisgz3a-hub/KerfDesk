import { describe, expect, it } from 'vitest';
import { MAX_TILE_PER_AXIS, MAX_TILE_TOTAL, tileIntoRegion, type TileLayout } from './tile-into-region';
import type { Bounds } from './scene-object';

const CELL: Bounds = { minX: 0, minY: 0, maxX: 10, maxY: 10 }; // 10×10 design at the origin
const REGION: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

function grid(rows: number, cols: number, gap = 0): TileLayout {
  return { kind: 'grid', rows, cols, gapXMm: gap, gapYMm: gap };
}

describe('tileIntoRegion', () => {
  it('produces rows × cols offsets for a grid, stepping by cell size', () => {
    const offsets = tileIntoRegion(CELL, REGION, grid(2, 2));
    expect(offsets).toHaveLength(4);
    // 2×2 of 10 mm cells (no gap) = 20 mm block centered in 100 mm → starts at 40
    expect(offsets[0]).toEqual({ dx: 40, dy: 40 });
    expect(offsets[1]).toEqual({ dx: 50, dy: 40 });
    expect(offsets[2]).toEqual({ dx: 40, dy: 50 });
    expect(offsets[3]).toEqual({ dx: 50, dy: 50 });
  });

  it('steps by cell size PLUS the gap', () => {
    const offsets = tileIntoRegion(CELL, REGION, grid(1, 2, 5));
    // adjacent columns are cellW(10) + gap(5) = 15 apart
    expect((offsets[1]?.dx ?? 0) - (offsets[0]?.dx ?? 0)).toBe(15);
  });

  it('auto-counts how many fit for a fill layout', () => {
    const cell: Bounds = { minX: 0, minY: 0, maxX: 30, maxY: 30 };
    const offsets = tileIntoRegion(cell, REGION, { kind: 'fill', gapXMm: 10, gapYMm: 10 });
    // floor((100 + 10) / (30 + 10)) = floor(2.75) = 2 per axis → 4
    expect(offsets).toHaveLength(4);
  });

  it('centers the fill block and never overflows the region', () => {
    const cell: Bounds = { minX: 0, minY: 0, maxX: 30, maxY: 30 };
    const offsets = tileIntoRegion(cell, REGION, { kind: 'fill', gapXMm: 10, gapYMm: 10 });
    // 2 cols of 30 with one 10 gap = 70 mm block, centered in 100 → starts at 15
    expect(offsets[0]?.dx).toBe(15);
    const lastRightEdge = 15 + (2 - 1) * (30 + 10) + 30;
    expect(lastRightEdge).toBeLessThanOrEqual(REGION.maxX);
  });

  it('centers a single-cell grid in the region', () => {
    const offsets = tileIntoRegion(CELL, REGION, grid(1, 1));
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toEqual({ dx: 45, dy: 45 }); // (100 - 10) / 2
  });

  it('returns offsets relative to the design current position', () => {
    const cell: Bounds = { minX: 20, minY: 20, maxX: 30, maxY: 30 }; // sits at (20,20)
    const offsets = tileIntoRegion(cell, REGION, grid(1, 1));
    // target center-slot start is 45; design currently at 20 → move by 25
    expect(offsets[0]).toEqual({ dx: 25, dy: 25 });
  });

  it('tiles a design larger than the board as one centered copy', () => {
    const big: Bounds = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    const offsets = tileIntoRegion(big, REGION, { kind: 'fill', gapXMm: 0, gapYMm: 0 });
    expect(offsets).toHaveLength(1);
    expect(offsets[0]).toEqual({ dx: -50, dy: -50 }); // (100 - 200) / 2
  });

  it('caps a runaway count at MAX_TILE_PER_AXIS', () => {
    const offsets = tileIntoRegion(CELL, REGION, grid(9999, 1));
    expect(offsets).toHaveLength(MAX_TILE_PER_AXIS);
  });

  it('caps the total tile count at MAX_TILE_TOTAL for a tiny design', () => {
    // 1 mm design in a 1000 mm region would be 100×100 = 10,000 without the cap.
    const tiny: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const big: Bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    const offsets = tileIntoRegion(tiny, big, { kind: 'fill', gapXMm: 0, gapYMm: 0 });
    expect(offsets.length).toBeLessThanOrEqual(MAX_TILE_TOTAL);
    expect(offsets.length).toBeGreaterThan(1);
  });

  it('treats a non-finite gap as zero instead of producing NaN offsets', () => {
    const offsets = tileIntoRegion(CELL, REGION, {
      kind: 'grid',
      rows: 2,
      cols: 2,
      gapXMm: Number.POSITIVE_INFINITY,
      gapYMm: Number.POSITIVE_INFINITY,
    });
    expect(offsets).toHaveLength(4);
    for (const offset of offsets) {
      expect(Number.isFinite(offset.dx)).toBe(true);
      expect(Number.isFinite(offset.dy)).toBe(true);
    }
  });

  it('clamps a non-positive grid count up to one', () => {
    const offsets = tileIntoRegion(CELL, REGION, grid(0, 1));
    expect(offsets).toHaveLength(1);
  });

  it('returns nothing for a degenerate cell or region', () => {
    const flatCell: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 10 };
    expect(tileIntoRegion(flatCell, REGION, grid(2, 2))).toEqual([]);
    const flatRegion: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 0 };
    expect(tileIntoRegion(CELL, flatRegion, grid(2, 2))).toEqual([]);
  });
});
