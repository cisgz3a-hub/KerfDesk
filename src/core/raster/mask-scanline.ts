// mask-scanline — pre-rasterizes an image mask's closed contours into the x
// crossings of ONE horizontal scan line, so a pixel row can be resolved by a
// parity lookup instead of re-walking every contour segment for every pixel.
//
// The per-pixel even-odd test is O(contourPoints) per pixel — a 5 MP engrave
// under a 2000-point traced mask is ~10^10 segment steps, and that path is
// shared with the real job compile. Every pixel on a scan line sees the same
// crossings, so computing them once per ROW and binary-searching the parity
// costs O(contourPoints) per row plus O(log crossings) per pixel.
//
// Verdicts are bit-identical to the per-pixel test: the crossing x uses the
// same expression, and membership is the parity of the crossings strictly to
// the right of the point, which is exactly what the per-pixel toggle counted.

import type { Vec2 } from '../scene';

export type MaskContours = ReadonlyArray<ReadonlyArray<Vec2>>;

/**
 * Ascending x coordinates where the mask contours cross the horizontal line
 * `rowY`, under the same half-open edge rule as the per-pixel even-odd test:
 * a segment counts only when exactly one endpoint is strictly above `rowY`,
 * which skips horizontal edges and counts a shared vertex once.
 */
export function maskRowCrossings(contours: MaskContours, rowY: number): Float64Array {
  const crossings: number[] = [];
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if (a === undefined || b === undefined) continue;
      if (a.y > rowY === b.y > rowY) continue;
      const x = a.x + ((rowY - a.y) / (b.y - a.y)) * (b.x - a.x);
      // `point.x < NaN` is false for every point, so a NaN crossing never
      // toggled membership. Dropping it preserves the parity and keeps the
      // sort total (NaN has no position in an ordered array).
      if (Number.isNaN(x)) continue;
      crossings.push(x);
    }
  }
  // TypedArray sort is numeric ascending by default — no comparator needed.
  const sorted = Float64Array.from(crossings);
  sorted.sort();
  return sorted;
}

/**
 * Even-odd membership for a pixel center at `pointX` on the row `crossings`
 * were taken from. The per-pixel test flipped membership once per crossing
 * strictly right of the point, so membership is the parity of that count.
 */
export function isInsideRowCrossings(crossings: Float64Array, pointX: number): boolean {
  // NaN compared false against every crossing, so it never flipped membership.
  if (Number.isNaN(pointX)) return false;
  let low = 0;
  let high = crossings.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const value = crossings[mid];
    if (value !== undefined && value <= pointX) low = mid + 1;
    else high = mid;
  }
  return (crossings.length - low) % 2 === 1;
}
