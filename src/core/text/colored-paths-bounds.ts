import { curveSubpathBounds, type Bounds, type ColoredPath } from '../scene';

/**
 * The box around placed or bent text: every polyline point and both corners of
 * every curve's box. A loop over the values, not Math.min(...values): a long
 * text holds millions of points, and the spread overflowed the call stack past
 * about 120,000 (performance audit S7-P2-3, ADR-691). Min and max do not depend
 * on order, so this is the box the spread gave.
 */
export function coloredPathsBounds(paths: ReadonlyArray<ColoredPath>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of paths) {
    for (const curve of path.curves ?? []) {
      const box = curveSubpathBounds(curve);
      minX = Math.min(minX, box.minX, box.maxX);
      maxX = Math.max(maxX, box.minX, box.maxX);
      minY = Math.min(minY, box.minY, box.maxY);
      maxY = Math.max(maxY, box.minY, box.maxY);
    }
    for (const polyline of path.polylines) {
      for (const point of polyline.points) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  return { minX, minY, maxX, maxY };
}
