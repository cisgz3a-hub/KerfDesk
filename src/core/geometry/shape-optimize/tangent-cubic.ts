// One cubic Bézier through points[from..to] leaving along a given tangent and
// arriving along another, for Optimize Shapes (LBG-T22), with an exact
// two-sided deviation bound against that stretch of polyline.
//
// The fit is Schneider's (Graphics Gems, 1990) as in cubic-fit.ts: chord-length
// parameters, least-squares arm lengths along the fixed tangents, then Newton
// reparameterization while it helps. Fixing both tangents makes consecutive
// cubics meet with one tangent (G1).
//
// The bound: with parameters u_k increasing from 0 at `from` to 1 at `to`, and
// e_k = |B(u_k) - P_k|, the cubic on [u_k, u_k+1] lies within
// dt^2 / 8 * max|B''| of the chord B(u_k)-B(u_k+1) (the linear interpolation
// error bound, dt = u_k+1 - u_k), and that chord lies within max(e_k, e_k+1) of
// the source edge P_k-P_k+1 point for matching point. So every point of the
// cubic is within max(e_k, e_k+1) + dt^2 / 8 * max|B''| of the source, and
// every point of the source is within the same of the cubic. B'' is linear in
// t, so max|B''| = 6 max(|P0 - 2P1 + P2|, |P1 - 2P2 + P3|).

import type { Vec2 } from '../../scene/scene-object';
import {
  chordParameterize,
  newtonProjectionStep,
  solveTangentArms,
  type CubicBezier,
} from '../cubic-fit';

const NEWTON_PASSES = 3;
// Arms beyond this share of the chord make a hook or loop, never a better fit.
const MAX_ARM_CHORDS = 1.5;
// A first fit whose points miss by this many tolerances is not worth refining.
const HOPELESS_TOLERANCES = 4;

/**
 * The cubic from points[from] to points[to] leaving along `tangentStart` and
 * arriving along `tangentEnd` (which points back from the last point into the
 * curve, as in cubic-fit.ts) that lies within `toleranceMm` of that stretch of
 * polyline both ways, or null when none is found. The first fit that passes is
 * taken, so a stretch that fits at once costs one pass.
 */
export function fitTangentCubicWithin(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  tangentStart: Vec2,
  tangentEnd: Vec2,
  toleranceMm: number,
): CubicBezier | null {
  let u = chordParameterize(points, from, to);
  let cubic = cubicWithArms(points, from, to, u, tangentStart, tangentEnd);
  if (cubic === null) return null;
  if (cubicFits(points, from, to, cubic, u, toleranceMm)) return cubic;
  let error = parametricError(points, from, to, cubic, u);
  if (error > HOPELESS_TOLERANCES * toleranceMm) return null;
  for (let pass = 0; pass < NEWTON_PASSES; pass += 1) {
    const nextU = reparameterized(points, from, to, cubic, u);
    const next = cubicWithArms(points, from, to, nextU, tangentStart, tangentEnd);
    if (next === null) return null;
    if (cubicFits(points, from, to, next, nextU, toleranceMm)) return next;
    const nextError = parametricError(points, from, to, next, nextU);
    if (!(nextError < error)) return null;
    cubic = next;
    u = nextU;
    error = nextError;
  }
  return null;
}

// Whether every point of the cubic and of points[from..to] lies within
// `toleranceMm` of the other, by the bound in the header.
function cubicFits(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
  toleranceMm: number,
): boolean {
  const curvature =
    (6 *
      Math.max(
        Math.hypot(
          cubic.p0.x - 2 * cubic.p1.x + cubic.p2.x,
          cubic.p0.y - 2 * cubic.p1.y + cubic.p2.y,
        ),
        Math.hypot(
          cubic.p1.x - 2 * cubic.p2.x + cubic.p3.x,
          cubic.p1.y - 2 * cubic.p2.y + cubic.p3.y,
        ),
      )) /
    8;
  let previousError = 0;
  for (let k = 1; k <= to - from; k += 1) {
    const step = (u[k] as number) - (u[k - 1] as number);
    if (step < 0) return false;
    const error = k === to - from ? 0 : pointError(cubic, u[k] as number, points[from + k] as Vec2);
    if (Math.max(previousError, error) + step * step * curvature > toleranceMm) return false;
    previousError = error;
  }
  return true;
}

function cubicWithArms(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  u: ReadonlyArray<number>,
  tangentStart: Vec2,
  tangentEnd: Vec2,
): CubicBezier | null {
  const p0 = points[from] as Vec2;
  const p3 = points[to] as Vec2;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  if (!(chord > 0)) return null;
  const arms = solveTangentArms(points, from, to, u, tangentStart, tangentEnd);
  const usable = (arm: number): boolean => arm > 0 && arm <= MAX_ARM_CHORDS * chord;
  const start = usable(arms.start) ? arms.start : chord / 3;
  const end = usable(arms.end) ? arms.end : chord / 3;
  return {
    p0,
    p1: { x: p0.x + tangentStart.x * start, y: p0.y + tangentStart.y * start },
    p2: { x: p3.x + tangentEnd.x * end, y: p3.y + tangentEnd.y * end },
    p3,
  };
}

// Newton steps toward each point's nearest parameter, kept inside (0, 1) and
// in order so the bound above applies.
function reparameterized(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
): number[] {
  const next = [...u];
  for (let k = 1; k < to - from; k += 1) {
    const stepped = newtonProjectionStep(cubic, points[from + k] as Vec2, u[k] as number);
    if (stepped !== null && stepped > 0 && stepped < 1) next[k] = stepped;
    next[k] = Math.max(next[k] as number, next[k - 1] as number);
  }
  for (let k = to - from - 1; k > 0; k -= 1) {
    next[k] = Math.min(next[k] as number, next[k + 1] as number);
  }
  return next;
}

function parametricError(
  points: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
): number {
  let worst = 0;
  for (let k = 1; k < to - from; k += 1) {
    worst = Math.max(worst, pointError(cubic, u[k] as number, points[from + k] as Vec2));
  }
  return worst;
}

// |B(t) - point|, without building B(t) as an object (this runs per point per try).
function pointError(cubic: CubicBezier, t: number, point: Vec2): number {
  const m = 1 - t;
  const b0 = m * m * m;
  const b1 = 3 * t * m * m;
  const b2 = 3 * t * t * m;
  const b3 = t * t * t;
  const x = b0 * cubic.p0.x + b1 * cubic.p1.x + b2 * cubic.p2.x + b3 * cubic.p3.x;
  const y = b0 * cubic.p0.y + b1 * cubic.p1.y + b2 * cubic.p2.y + b3 * cubic.p3.y;
  return Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2);
}
