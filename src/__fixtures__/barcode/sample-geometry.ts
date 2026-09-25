// Reads engraving geometry back into modules the way a camera would see it:
// the colour at each module centre under even-odd fill. Tests decode the
// sampled grid, so they check the outlines themselves, not the encoder's
// intermediate matrix.

import type { Polyline, Vec2 } from '../../core/scene';

export function insideEvenOdd(polylines: readonly Polyline[], point: Vec2): boolean {
  let inside = false;
  for (const polyline of polylines) {
    const points = polyline.points;
    for (
      let index = 0, previous = points.length - 1;
      index < points.length;
      previous = index, index += 1
    ) {
      const a = points[index];
      const b = points[previous];
      if (a === undefined || b === undefined) continue;
      if (
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Row-major 1 = filled, sampled at module centres of a grid starting at origin. */
export function sampleGrid(
  polylines: readonly Polyline[],
  columns: number,
  rows: number,
  moduleMm: number,
  originMm: Vec2,
): Uint8Array {
  const grid = new Uint8Array(columns * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      const centre = { x: originMm.x + (x + 0.5) * moduleMm, y: originMm.y + (y + 0.5) * moduleMm };
      grid[y * columns + x] = insideEvenOdd(polylines, centre) ? 1 : 0;
    }
  }
  return grid;
}

/** '1'/'0' along a horizontal scan line through module centres. */
export function sampleScanLine(
  polylines: readonly Polyline[],
  modules: number,
  moduleMm: number,
  originXMm: number,
  yMm: number,
): string {
  let line = '';
  for (let x = 0; x < modules; x += 1) {
    line += insideEvenOdd(polylines, { x: originXMm + (x + 0.5) * moduleMm, y: yMm }) ? '1' : '0';
  }
  return line;
}
