import { curveSubpathBounds, type Bounds, type ColoredPath } from '../scene';

// Tight bounding box around every point in every ColoredPath. Used by
// ImportImageDialog (and any future caller) to construct the
// TracedImage's `bounds` field — analogous to parseSvg's viewBox-based
// bounds but always reflecting the actual traced geometry. Empty input
// returns a zero-area bounds at the origin.
export function boundsFromColoredPaths(paths: ReadonlyArray<ColoredPath>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    if (path.curves !== undefined) {
      for (const curve of path.curves) {
        const bounds = curveSubpathBounds(curve);
        minX = Math.min(minX, bounds.minX);
        minY = Math.min(minY, bounds.minY);
        maxX = Math.max(maxX, bounds.maxX);
        maxY = Math.max(maxY, bounds.maxY);
      }
      continue;
    }
    for (const pl of path.polylines) {
      for (const p of pl.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}
