// Overcut (LBG-C02, ADR-415): a closed Line contour keeps cutting past its
// start point for `overcutMm`, retracing its own first edges, so the seam where
// the beam started and stopped is cut through. The retrace follows the path
// exactly and never leaves it; an overcut longer than the contour goes round
// once more and no further.

import type { Vec2 } from '../scene';
import { pathWalk, pointAtDistance, samePoint } from './path-walk';

const MIN_OVERCUT_MM = 0.001;
const EPS = 1e-9;

/** `points` is a closed contour that ends where it starts. Anything else, and
 * any overcut too short to reach the emitter's resolution, comes back as is. */
export function overcutClosedPolyline(
  points: ReadonlyArray<Vec2>,
  overcutMm: number,
): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || !samePoint(first, last)) return points;
  if (!(overcutMm >= MIN_OVERCUT_MM)) return points;
  const walk = pathWalk({ points, closed: true });
  if (walk === null) return points;
  const runMm = Math.min(overcutMm, walk.lengthMm);
  const out = [...points];
  for (let i = 1; i < walk.points.length; i += 1) {
    if ((walk.cumulative[i] ?? 0) >= runMm - EPS) break;
    out.push(walk.points[i] as Vec2);
  }
  out.push(pointAtDistance(walk, runMm));
  return out;
}
