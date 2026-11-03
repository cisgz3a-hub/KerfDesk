// Bands of a pool raster (fill-pool-raster.ts, ADR-683 Amendment 3). The cost
// of painting a dense even-odd region grows with how many segments cross each
// pixel row, so rows are measured once and bands are cut to a budget of
// segment-rows. A band paints only the contours that reach its rows: a contour
// wholly above or below them, by more than half the outline and a pixel of
// antialiasing, cannot change a pixel in them.

import type { Polyline } from '../../core/scene';

export type RasterRows = {
  /** Cost of each pixel row: segments crossing it, plus segments whose contour starts there. */
  readonly cost: Float64Array;
  /** Each contour's lowest and highest pixel row, as fractions. */
  readonly top: Float64Array;
  readonly bottom: Float64Array;
  /** Rows a contour reaches past its own extent (half the outline, plus antialiasing). */
  readonly pad: number;
};

/** Measure a pool's rows in a raster whose pixel (0, 0) is at `worldY0` (mm), `scale` px/mm. */
export function rasterRows(
  contours: ReadonlyArray<Polyline>,
  frame: { readonly worldY0: number; readonly scale: number },
  height: number,
  widthPx: number,
): RasterRows {
  const crossings = new Float64Array(height + 1);
  const cost = new Float64Array(height);
  const top = new Float64Array(contours.length);
  const bottom = new Float64Array(contours.length);
  const rowOf = (y: number): number => (y - frame.worldY0) * frame.scale;
  const clampRow = (row: number): number => Math.min(height - 1, Math.max(0, Math.floor(row)));
  contours.forEach((contour, index) => {
    const points = contour.points;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1) {
      const a = rowOf((points[i] as Polyline['points'][number]).y);
      const b = rowOf((points[(i + 1) % points.length] as Polyline['points'][number]).y);
      low = Math.min(low, a);
      high = Math.max(high, a);
      (crossings[clampRow(Math.min(a, b))] as number) += 1;
      (crossings[clampRow(Math.max(a, b)) + 1] as number) -= 1;
    }
    top[index] = low;
    bottom[index] = high;
    if (points.length > 0) (cost[clampRow(low)] as number) += points.length;
  });
  let running = 0;
  for (let row = 0; row < height; row += 1) {
    running += crossings[row] as number;
    (cost[row] as number) += running;
  }
  return { cost, top, bottom, pad: widthPx / 2 + 2 };
}

/** The next band from row `from`: rows until their cost reaches `budget`, at least one. */
export function nextBand(
  rows: RasterRows,
  from: number,
  budget: number,
): { readonly from: number; readonly to: number; readonly cost: number } {
  let to = from;
  let cost = 0;
  while (to < rows.cost.length && (to === from || cost + (rows.cost[to] as number) <= budget)) {
    cost += rows.cost[to] as number;
    to += 1;
  }
  return { from, to, cost };
}

/** The contours that can change a pixel in rows [from, to). */
export function bandContours(
  rows: RasterRows,
  contours: ReadonlyArray<Polyline>,
  from: number,
  to: number,
): Polyline[] {
  return contours.filter(
    (_, index) =>
      (rows.bottom[index] as number) >= from - rows.pad &&
      (rows.top[index] as number) <= to + rows.pad,
  );
}
