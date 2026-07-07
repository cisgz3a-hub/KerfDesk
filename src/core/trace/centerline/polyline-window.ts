// Small shared geometry helpers for window-based polyline surgery
// (bend sharpening, junction-seam repair).

import type { Vec2 } from '../../scene';
import { radiusAt } from './distance-field';

/** Drop points within `arc` length of the given end. Always keeps at least
 *  the far endpoint. */
export function trimArc(points: ReadonlyArray<Vec2>, end: 'head' | 'tail', arc: number): Vec2[] {
  const pts = end === 'head' ? [...points].reverse() : [...points];
  let cum = 0;
  let keep = pts.length - 1;
  for (let i = pts.length - 1; i > 0; i -= 1) {
    const a = pts[i];
    const b = pts[i - 1];
    if (a === undefined || b === undefined) break;
    cum += Math.hypot(a.x - b.x, a.y - b.y);
    keep = i;
    if (cum > arc) break;
  }
  const trimmed = pts.slice(0, keep);
  return end === 'head' ? trimmed.reverse() : trimmed;
}

/** Closest point to `p` on segment a→b. */
export function projectOntoSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Local stroke radius (distance-field value) at a sub-pixel position. The
 *  cell is clamped to the field on BOTH axes: a point at/past the right or
 *  bottom border must read the edge cell, not wrap into the next row or
 *  fall off the end (which `radiusAt`'s `?? 0` would silently report as
 *  zero radius — a wrong "no stroke here" for a boundary vertex). */
export function radiusAtPosition(p: Vec2, distSq: Float64Array, width: number): number {
  const height = width > 0 ? Math.floor(distSq.length / width) : 0;
  const x = Math.max(0, Math.min(width - 1, Math.round(p.x - 0.5)));
  const y = Math.max(0, Math.min(height - 1, Math.round(p.y - 0.5)));
  return radiusAt(distSq, y * width + x);
}

/** The point roughly `distance` of arc length in from one end of a polyline
 *  (from the start when `fromStart`, else from the end). */
export function pointAtArcDistance(
  pts: ReadonlyArray<Vec2>,
  fromStart: boolean,
  distance: number,
): Vec2 | undefined {
  let remaining = distance;
  const count = pts.length;
  for (let step = 1; step < count; step += 1) {
    const a = fromStart ? pts[step - 1] : pts[count - step];
    const b = fromStart ? pts[step] : pts[count - 1 - step];
    if (a === undefined || b === undefined) break;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= remaining) return b;
    remaining -= seg;
  }
  return fromStart ? pts.at(-1) : pts[0];
}
