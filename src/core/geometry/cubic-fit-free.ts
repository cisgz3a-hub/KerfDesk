// cubic-fit-free — least-squares fit of ONE cubic Bézier between the first and
// last point with both handles free. Node deletion falls back to it when the
// fit that keeps the outer tangent directions cannot follow the removed curve,
// such as a hump whose outer tangents lie along its chord (ADR-371 Amendment 1).
// Same method as cubic-fit's tangent fit: chord-length parameters, the normal
// equations for the unknown control points, then Newton reparameterization
// while it reduces the error.
//
// Pure core — no I/O, no globals, deterministic.

import type { Vec2 } from '../scene';
import {
  chordParameterize,
  evaluateCubic,
  newtonProjectionStep,
  type CubicBezier,
} from './cubic-fit';

const MAX_REPARAM_PASSES = 8;

/** The cubic from the first to the last point whose two handles minimise the
 *  squared distance to the points; null for fewer than three points or when
 *  the points leave the handles undetermined. */
export function fitCubicFree(points: ReadonlyArray<Vec2>): CubicBezier | null {
  const last = points.length - 1;
  if (last < 2) return null;
  let u: ReadonlyArray<number> = chordParameterize(points, 0, last);
  let cubic = solveHandles(points, u);
  if (cubic === null) return null;
  let errorSq = maxErrorSq(points, cubic, u);
  for (let pass = 0; pass < MAX_REPARAM_PASSES; pass += 1) {
    const next = reparameterized(points, cubic, u);
    const refit = solveHandles(points, next);
    if (refit === null) break;
    const refitErrorSq = maxErrorSq(points, refit, next);
    if (refitErrorSq >= errorSq) break;
    cubic = refit;
    errorSq = refitErrorSq;
    u = next;
  }
  return cubic;
}

// With P0 and P3 fixed, the residual r = P - (B0 P0 + B3 P3) is linear in the
// handles, B1 P1 + B2 P2: one 2x2 system shared by x and y.
function solveHandles(points: ReadonlyArray<Vec2>, u: ReadonlyArray<number>): CubicBezier | null {
  const p0 = points[0] as Vec2;
  const p3 = points[points.length - 1] as Vec2;
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let r1x = 0;
  let r1y = 0;
  let r2x = 0;
  let r2y = 0;
  points.forEach((point, index) => {
    const t = u[index] as number;
    const m = 1 - t;
    const b0 = m * m * m;
    const b1 = 3 * t * m * m;
    const b2 = 3 * t * t * m;
    const b3 = t * t * t;
    const rx = point.x - (b0 * p0.x + b3 * p3.x);
    const ry = point.y - (b0 * p0.y + b3 * p3.y);
    a11 += b1 * b1;
    a12 += b1 * b2;
    a22 += b2 * b2;
    r1x += b1 * rx;
    r1y += b1 * ry;
    r2x += b2 * rx;
    r2y += b2 * ry;
  });
  const det = a11 * a22 - a12 * a12;
  if (!(Math.abs(det) > 1e-12 * a11 * a22)) return null;
  return {
    p0,
    p1: { x: (a22 * r1x - a12 * r2x) / det, y: (a22 * r1y - a12 * r2y) / det },
    p2: { x: (a11 * r2x - a12 * r1x) / det, y: (a11 * r2y - a12 * r1y) / det },
    p3,
  };
}

function reparameterized(
  points: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
): number[] {
  return u.map((t, index) => {
    if (index === 0 || index === u.length - 1) return t;
    const next = newtonProjectionStep(cubic, points[index] as Vec2, t);
    return next !== null && next > 0 && next < 1 ? next : t;
  });
}

function maxErrorSq(
  points: ReadonlyArray<Vec2>,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
): number {
  let maxSq = 0;
  points.forEach((point, index) => {
    const q = evaluateCubic(cubic, u[index] as number);
    maxSq = Math.max(maxSq, (q.x - point.x) ** 2 + (q.y - point.y) ** 2);
  });
  return maxSq;
}
