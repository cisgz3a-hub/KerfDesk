// Biarcs (ADR-432): two circular arcs, tangent to each other at a junction,
// joining two points with prescribed unit tangents. Among the one-parameter
// family this uses the equal-tangent-length biarc of Bolton ("Biarc curves",
// Computer-Aided Design 7(2):89-92, 1975): control points A = P0 + d T0 and
// B = P1 - d T1 with |B - A| = 2d, junction at their midpoint. On a circle it
// reproduces that circle (the junction lands on it), so a traced circle comes
// back as arcs of one circle that the fitter merges.
//
// Solving |P1 - P0 - d (T0 + T1)|^2 = 4 d^2 for d:
//   2 (1 - T0.T1) d^2 + 2 (v.t) d - v.v = 0,  v = P1 - P0, t = T0 + T1.

import type { Vec2 } from '../../scene';
import { primitiveFitsPiece } from './arc-piece-check';
import { arcLeavingAlong, reversePrimitive, unit, type FitPrimitive } from './arc-primitives';

export type Biarc = {
  readonly first: FitPrimitive;
  readonly second: FitPrimitive;
  readonly junction: Vec2;
  /** Unit tangent at the junction. */
  readonly junctionTangent: Vec2;
};

const PARALLEL_EPSILON = 1e-12;

export function biarcBetween(p0: Vec2, t0: Vec2, p1: Vec2, t1: Vec2): Biarc | null {
  const vx = p1.x - p0.x;
  const vy = p1.y - p0.y;
  const vv = vx * vx + vy * vy;
  if (!(vv > 0)) return null;
  const tx = t0.x + t1.x;
  const ty = t0.y + t1.y;
  const vt = vx * tx + vy * ty;
  const a = 2 * (1 - (t0.x * t1.x + t0.y * t1.y));
  let d: number;
  if (a < PARALLEL_EPSILON) {
    if (!(vt > PARALLEL_EPSILON)) return null;
    d = vv / (2 * vt);
  } else {
    d = (-vt + Math.sqrt(vt * vt + a * vv)) / a;
  }
  if (!(d > 0) || !Number.isFinite(d)) return null;
  const ax = p0.x + d * t0.x;
  const ay = p0.y + d * t0.y;
  const bx = p1.x - d * t1.x;
  const by = p1.y - d * t1.y;
  const junction = { x: (ax + bx) / 2, y: (ay + by) / 2 };
  const junctionTangent = Math.hypot(bx - ax, by - ay) > 0 ? unit(bx - ax, by - ay) : t0;
  const first = arcLeavingAlong(p0, t0, junction);
  const backward = arcLeavingAlong(p1, { x: -t1.x, y: -t1.y }, junction);
  if (first === null || backward === null) return null;
  return { first, second: reversePrimitive(backward), junction, junctionTangent };
}

/**
 * Whether the biarc stays within the bound of the source polyline `points`
 * (from its start to its end). The source is split where it first crosses the
 * common normal at the junction, which passes through both centres, so each
 * arc is checked against exactly the source between its own end rays.
 */
export function biarcFitsPoints(
  biarc: Biarc,
  points: ReadonlyArray<Vec2>,
  toleranceMm: number,
): boolean {
  return biarcFitsPiece(biarc, points, 0, points.length - 1, toleranceMm);
}

export function biarcFitsPiece(
  biarc: Biarc,
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  toleranceMm: number,
): boolean {
  const { junction, junctionTangent } = biarc;
  const side = (point: Vec2): number =>
    (point.x - junction.x) * junctionTangent.x + (point.y - junction.y) * junctionTangent.y;
  let previous = side(points[from] as Vec2);
  for (let index = from + 1; index <= to; index += 1) {
    const current = side(points[index] as Vec2);
    if (current >= 0) {
      const a = points[index - 1] as Vec2;
      const b = points[index] as Vec2;
      const t = previous < 0 ? previous / (previous - current) : 0;
      const crossing = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return (
        primitiveFitsPiece(
          biarc.first,
          { points, from, to: index - 1, tail: crossing },
          toleranceMm,
        ) &&
        primitiveFitsPiece(biarc.second, { points, from: index, to, head: crossing }, toleranceMm)
      );
    }
    previous = current;
  }
  return false;
}
