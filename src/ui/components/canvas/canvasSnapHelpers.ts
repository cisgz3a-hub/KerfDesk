/**
 * T1-150: pure snap-grid + object-snap helpers extracted from
 * CanvasViewport. Pre-T1-150 these three helpers (`snapToGrid`,
 * `getObjectSnapPoints`, `findSnapPoint`) lived inside the 1951-line
 * CanvasViewport.tsx mixed with the heavy mouse-handler logic. They
 * are pure functions over scene-object geometry — no React, no canvas
 * mutation — but loading them required the viewport's full import
 * surface (history manager, scene store, mouse-handler types, etc.).
 *
 *   - `snapToGrid(value, gridSize)`: rounds `value` to the nearest
 *     multiple of `gridSize`. Returns `value` unchanged when `gridSize`
 *     is non-positive (snap-off sentinel).
 *   - `getObjectSnapPoints(obj)`: returns the snap-target points for
 *     a scene object (corners, midpoints, center for rects; cardinals
 *     + center for ellipses; endpoints + midpoint for lines; vertices
 *     for polygons; fallback to object origin for other types).
 *   - `findSnapPoint(x, y, excludeIds, objects, snapDist)`: scans all
 *     non-excluded visible objects' snap points and returns the closest
 *     one within `snapDist`, or `(x, y, snapped: false)` if nothing
 *     close enough.
 *
 * Hoisting these to a sibling module:
 *   - lets the snap rules be tested with synthetic scenes
 *   - documents the per-geometry-type snap-point set
 *   - clears CanvasViewport for the next slice
 */
import type { SceneObject } from '../../../core/scene/SceneObject';

/**
 * Snap `value` to the nearest multiple of `gridSize`. When
 * `gridSize <= 0` the function returns `value` unchanged — the
 * conventional "snap off" sentinel.
 */
export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Build the snap-target point list for a single scene object.
 * Geometry-specific:
 *   - rect:     4 corners + center + 4 edge midpoints = 9 points
 *   - ellipse:  center + 4 cardinal points = 5 points
 *   - line:     2 endpoints + 1 midpoint = 3 points
 *   - polygon:  every vertex
 *   - default:  the object's transform origin
 *
 * NOTE: the rect/ellipse/line transforms only use the diagonal of
 * the affine matrix (`a` for X, `d` for Y) plus the translation
 * components — they're not rotation-aware. This matches the
 * pre-T1-150 behavior; rotated objects' snap points sit on the
 * AABB's diagonal rather than rotated.
 */
export function getObjectSnapPoints(obj: SceneObject): Array<{ x: number; y: number }> {
  const t = obj.transform;
  const g = obj.geometry;
  const pts: Array<{ x: number; y: number }> = [];

  if (g.type === 'rect') {
    const x1 = t.a * g.x + t.tx;
    const y1 = t.d * g.y + t.ty;
    const x2 = t.a * (g.x + g.width) + t.tx;
    const y2 = t.d * (g.y + g.height) + t.ty;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    pts.push({ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 });
    pts.push({ x: cx, y: cy });
    pts.push({ x: cx, y: y1 }, { x: x2, y: cy }, { x: cx, y: y2 }, { x: x1, y: cy });
  } else if (g.type === 'ellipse') {
    const cx = t.a * g.cx + t.tx;
    const cy = t.d * g.cy + t.ty;
    pts.push({ x: cx, y: cy });
    pts.push({ x: cx - t.a * g.rx, y: cy });
    pts.push({ x: cx + t.a * g.rx, y: cy });
    pts.push({ x: cx, y: cy - t.d * g.ry });
    pts.push({ x: cx, y: cy + t.d * g.ry });
  } else if (g.type === 'line') {
    pts.push({ x: t.a * g.x1 + t.tx, y: t.d * g.y1 + t.ty });
    pts.push({ x: t.a * g.x2 + t.tx, y: t.d * g.y2 + t.ty });
    pts.push({
      x: t.a * ((g.x1 + g.x2) / 2) + t.tx,
      y: t.d * ((g.y1 + g.y2) / 2) + t.ty,
    });
  } else if (g.type === 'polygon') {
    for (const pt of g.points) {
      pts.push({ x: t.a * pt.x + t.tx, y: t.d * pt.y + t.ty });
    }
  } else {
    pts.push({ x: t.tx, y: t.ty });
  }

  return pts;
}

/** Result of a snap-point search. */
export interface SnapPointResult {
  x: number;
  y: number;
  snapped: boolean;
}

/**
 * Find the nearest snap point from `objects` (excluding the IDs in
 * `excludeIds` and invisible objects) within `snapDist` of (x, y).
 * Returns the snapped point + a `snapped` flag. When nothing is
 * close enough, returns the input (x, y) with `snapped: false`.
 */
export function findSnapPoint(
  x: number,
  y: number,
  excludeIds: Set<string>,
  objects: SceneObject[],
  snapDist: number,
): SnapPointResult {
  let bestDist = snapDist;
  let sx = x;
  let sy = y;
  let snapped = false;

  for (const obj of objects) {
    if (excludeIds.has(obj.id) || !obj.visible) continue;
    for (const p of getObjectSnapPoints(obj)) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestDist) {
        bestDist = d;
        sx = p.x;
        sy = p.y;
        snapped = true;
      }
    }
  }

  return { x: sx, y: sy, snapped };
}
