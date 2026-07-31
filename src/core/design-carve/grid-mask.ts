// grid-mask — even-odd scanline rasterization of closed contours onto the
// carve grid. Even-odd is the load-bearing choice: a layer holding an outer
// rectangle and an inner rectangle rasterizes to the BAND between them (the
// picture frame's recessed field), matching how v-carve region grouping and
// fill read multi-contour artwork.

import type { Polyline } from '../scene';
import type { CarveGrid } from './carve-input';

/** 1 = inside under the even-odd rule, 0 = outside. Row-major, like Heightmap. */
export function rasterizeEvenOdd(contours: ReadonlyArray<Polyline>, grid: CarveGrid): Uint8Array {
  const mask = new Uint8Array(grid.widthCells * grid.heightCells);
  const closed = contours.filter((polyline) => polyline.closed && polyline.points.length >= 3);
  if (closed.length === 0) return mask;
  for (let cy = 0; cy < grid.heightCells; cy += 1) {
    const y = grid.originY + (cy + 0.5) * grid.mmPerCell;
    fillRowSpans(mask, cy, rowCrossings(closed, y), grid);
  }
  return mask;
}

// X coordinates where contour edges cross the scanline, sorted. The half-open
// rule (y1 <= y < y2) counts a vertex exactly once, so touching corners cannot
// double-fill or leak.
function rowCrossings(contours: ReadonlyArray<Polyline>, y: number): ReadonlyArray<number> {
  const crossings: number[] = [];
  for (const contour of contours) {
    const points = contour.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      const crosses = a.y <= y ? b.y > y : b.y <= y;
      if (!crosses || a.y === b.y) continue;
      crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
  }
  return crossings.sort((left, right) => left - right);
}

function fillRowSpans(
  mask: Uint8Array,
  cy: number,
  crossings: ReadonlyArray<number>,
  grid: CarveGrid,
): void {
  const rowStart = cy * grid.widthCells;
  for (let pair = 0; pair + 1 < crossings.length; pair += 2) {
    const xa = crossings[pair];
    const xb = crossings[pair + 1];
    if (xa === undefined || xb === undefined) continue;
    // A cell belongs to the span when its CENTER lies inside [xa, xb).
    const first = Math.max(0, Math.ceil((xa - grid.originX) / grid.mmPerCell - 0.5));
    const last = Math.min(
      grid.widthCells - 1,
      Math.floor((xb - grid.originX) / grid.mmPerCell - 0.5),
    );
    for (let cx = first; cx <= last; cx += 1) mask[rowStart + cx] = 1;
  }
}
