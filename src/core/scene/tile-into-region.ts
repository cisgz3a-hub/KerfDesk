// tileIntoRegion — computes where to place a grid of copies of a design (whose
// current scene footprint is `cell`) so they tile the `region` (a placed board).
// Pure geometry: returns one translation offset per grid slot, relative to the
// design's current position, so the store can apply offset[0] to the original
// and offsets[1..] to fresh duplicates. The whole block is centered in the
// region. 'fill' auto-counts how many fit; 'grid' takes an explicit rows × cols.

import type { Bounds } from './scene-object';

export type TileLayout =
  | {
      readonly kind: 'grid';
      readonly rows: number;
      readonly cols: number;
      readonly gapXMm: number;
      readonly gapYMm: number;
    }
  | { readonly kind: 'fill'; readonly gapXMm: number; readonly gapYMm: number };

export type TileOffset = { readonly dx: number; readonly dy: number };

// A typo (9999 rows) or a 0.1 mm design in a 1 m region shouldn't spawn millions
// of objects; cap each axis. Realistic board tiling stays well under this.
export const MAX_TILE_PER_AXIS = 100;

// Even within the per-axis cap, a tiny design under "fit as many as fit" could
// spawn MAX_TILE_PER_AXIS² = 10,000 objects and freeze the scene; cap the total
// to a sane sheet size and scale the grid down proportionally when it exceeds it.
export const MAX_TILE_TOTAL = 500;

export function tileIntoRegion(
  cell: Bounds,
  region: Bounds,
  layout: TileLayout,
): ReadonlyArray<TileOffset> {
  const cellW = cell.maxX - cell.minX;
  const cellH = cell.maxY - cell.minY;
  const regionW = region.maxX - region.minX;
  const regionH = region.maxY - region.minY;
  if (cellW <= 0 || cellH <= 0 || regionW <= 0 || regionH <= 0) return [];

  const gapX = finiteNonNeg(layout.gapXMm);
  const gapY = finiteNonNeg(layout.gapYMm);
  let cols = clampCount(layout.kind === 'fill' ? fitCount(regionW, cellW, gapX) : layout.cols);
  let rows = clampCount(layout.kind === 'fill' ? fitCount(regionH, cellH, gapY) : layout.rows);
  if (cols * rows > MAX_TILE_TOTAL) {
    // Scale the grid down proportionally so a runaway count can't freeze the scene.
    const shrink = Math.sqrt(MAX_TILE_TOTAL / (cols * rows));
    cols = Math.max(1, Math.floor(cols * shrink));
    rows = Math.max(1, Math.floor(rows * shrink));
  }

  // Center the whole block in the region.
  const startX = region.minX + (regionW - (cols * cellW + (cols - 1) * gapX)) / 2;
  const startY = region.minY + (regionH - (rows * cellH + (rows - 1) * gapY)) / 2;

  const offsets: TileOffset[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      offsets.push({
        dx: startX + col * (cellW + gapX) - cell.minX,
        dy: startY + row * (cellH + gapY) - cell.minY,
      });
    }
  }
  return offsets;
}

// How many cells (plus the gap between them) fit across `regionSpan`. Always at
// least one — a design larger than the board still tiles as a single copy.
function fitCount(regionSpan: number, cellSpan: number, gap: number): number {
  return Math.max(1, Math.floor((regionSpan + gap) / (cellSpan + gap)));
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_TILE_PER_AXIS, Math.floor(value)));
}

// A non-finite gap (e.g. the form yielding Infinity from a huge literal) would
// propagate NaN into every offset and poison the placement/G-code; clamp it.
function finiteNonNeg(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
