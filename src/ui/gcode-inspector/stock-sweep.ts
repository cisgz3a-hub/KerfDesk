// Sweeps a bit along one straight move through the carved stock's removal
// grid (ADR-487). Each cell keeps the deepest the bit's cutting surface has
// been over it, as the Cut 3D simulator does, but a move is swept in one pass
// rather than stamped at every half cell along it: stamping repeats each cell
// once for every sample the bit covers it at, about 50 times over for a 6 mm
// bit, which made a pocket take seconds to carve.
//
// A move at one height, or any move of a flat end mill, is swept exactly: a
// cell is cut to the move's height (plus the bit's profile at the cell's
// distance from the move), or, for an end mill on a slope, to the lowest
// height along the part of the move within the bit's radius. A sloped move of
// a ball or V bit, as in a relief or a V-carving, is stamped at every cell
// along it, with the bit's tip where the move puts it.

import type { RemovalGrid } from '../../core/sim/removal-grid';
import type { ToolKernel } from '../../core/sim/tool-kernels';

export type SweepPoint = { readonly x: number; readonly y: number; readonly z: number };

/** Rows of the grid a sweep reached, inclusive; empty when it cut nothing. */
export type SweptRows = { first: number; last: number };

const LEVEL_MM = 1e-6;

/**
 * Sweeps the bit from `from` to `upTo` of the way to `to`, and widens `rows`
 * to take in the rows it reached.
 */
export function sweepMove(
  grid: RemovalGrid,
  kernel: ToolKernel,
  from: SweepPoint,
  to: SweepPoint,
  upTo: number,
  rows: SweptRows,
): void {
  const end = Math.min(1, Math.max(0, upTo));
  const reached = {
    x: from.x + (to.x - from.x) * end,
    y: from.y + (to.y - from.y) * end,
    z: from.z + (to.z - from.z) * end,
  };
  if (from.z >= 0 && reached.z >= 0) return;
  const level = Math.abs(reached.z - from.z) <= LEVEL_MM;
  if (level || kernel.tool.kind === 'end-mill') sweepExactly(grid, kernel, from, reached, rows);
  else stampAlong(grid, kernel, from, reached, rows);
}

// Every cell within the bit's radius of the move, cut to its lowest point.
function sweepExactly(
  grid: RemovalGrid,
  kernel: ToolKernel,
  a: SweepPoint,
  b: SweepPoint,
  rows: SweptRows,
): void {
  const radius = kernel.radiusMm;
  const flat = kernel.tool.kind === 'end-mill';
  const span = cellSpan(grid, a, b, radius);
  if (span === null) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const cell = grid.mmPerCell;
  for (let row = span.firstRow; row <= span.lastRow; row += 1) {
    const py = grid.originY + (row + 0.5) * cell;
    for (let column = span.firstColumn; column <= span.lastColumn; column += 1) {
      const px = grid.originX + (column + 0.5) * cell;
      const along = lengthSquared > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / lengthSquared : 0;
      const t = Math.min(1, Math.max(0, along));
      const offX = px - (a.x + dx * t);
      const offY = py - (a.y + dy * t);
      const distanceSquared = offX * offX + offY * offY;
      if (distanceSquared > radius * radius) continue;
      const depth = flat
        ? lowestWithin(a, b, along, reachAlong(px - a.x, py - a.y, along, lengthSquared, radius))
        : a.z + kernel.surfaceDzAtRadius(Math.sqrt(distanceSquared));
      cut(grid, row * grid.widthCells + column, depth);
    }
  }
  widen(rows, span.firstRow, span.lastRow);
}

// How far either side of the closest point on the move's line, as a share of
// the move, the bit still covers the cell: the cell lies `perpendicular` off
// the line, so the bit covers it while it is within the radius along it too.
function reachAlong(
  offX: number,
  offY: number,
  along: number,
  lengthSquared: number,
  radius: number,
): number {
  if (lengthSquared === 0) return 1;
  const perpendicularSquared = Math.max(
    0,
    offX * offX + offY * offY - along * along * lengthSquared,
  );
  return Math.sqrt(Math.max(0, radius * radius - perpendicularSquared) / lengthSquared);
}

// A flat bottom on a slope: the lowest height along the stretch of the move
// that covers the cell, which is at one end of that stretch.
function lowestWithin(a: SweepPoint, b: SweepPoint, along: number, reach: number): number {
  const first = Math.min(1, Math.max(0, along - reach));
  const last = Math.min(1, Math.max(0, along + reach));
  return Math.min(a.z + (b.z - a.z) * first, a.z + (b.z - a.z) * last);
}

// A ball or V bit down a slope: its footprint at every cell along the move.
function stampAlong(
  grid: RemovalGrid,
  kernel: ToolKernel,
  a: SweepPoint,
  b: SweepPoint,
  rows: SweptRows,
): void {
  const cell = grid.mmPerCell;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / cell));
  // The move before ended where this one starts, and was stamped there.
  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const z = a.z + (b.z - a.z) * t;
    if (z >= 0) continue;
    stampTip(grid, kernel, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, z, rows);
  }
}

// The bit's footprint with its tip where the move puts it (ADR-580): each
// cell takes the cutting surface at its centre's true distance from the tip.
// Snapping the tip to the nearest cell centre moved the bit up to half a cell,
// which beside a vertical wall cut into it, and the design compare read that
// as the carving cut too deep.
function stampTip(
  grid: RemovalGrid,
  kernel: ToolKernel,
  x: number,
  y: number,
  z: number,
  rows: SweptRows,
): void {
  const span = cellSpan(grid, { x, y, z }, { x, y, z }, kernel.radiusMm);
  if (span === null) return;
  const cell = grid.mmPerCell;
  const radiusSquared = kernel.radiusMm * kernel.radiusMm;
  for (let row = span.firstRow; row <= span.lastRow; row += 1) {
    const dy = grid.originY + (row + 0.5) * cell - y;
    for (let column = span.firstColumn; column <= span.lastColumn; column += 1) {
      const dx = grid.originX + (column + 0.5) * cell - x;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radiusSquared) continue;
      cut(
        grid,
        row * grid.widthCells + column,
        z + kernel.surfaceDzAtRadius(Math.sqrt(distanceSquared)),
      );
    }
  }
  widen(rows, span.firstRow, span.lastRow);
}

function cut(grid: RemovalGrid, index: number, depth: number): void {
  if (depth < 0 && depth < (grid.depth[index] ?? 0)) grid.depth[index] = depth;
}

function widen(rows: SweptRows, first: number, last: number): void {
  rows.first = Math.min(rows.first, first);
  rows.last = Math.max(rows.last, last);
}

// The cells whose centres can lie within the radius of the move.
function cellSpan(
  grid: RemovalGrid,
  a: SweepPoint,
  b: SweepPoint,
  radius: number,
): { firstColumn: number; lastColumn: number; firstRow: number; lastRow: number } | null {
  const cell = grid.mmPerCell;
  const firstColumn = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - grid.originX) / cell));
  const lastColumn = Math.min(
    grid.widthCells - 1,
    Math.floor((Math.max(a.x, b.x) + radius - grid.originX) / cell),
  );
  const firstRow = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius - grid.originY) / cell));
  const lastRow = Math.min(
    grid.heightCells - 1,
    Math.floor((Math.max(a.y, b.y) + radius - grid.originY) / cell),
  );
  if (firstColumn > lastColumn || firstRow > lastRow) return null;
  return { firstColumn, lastColumn, firstRow, lastRow };
}
