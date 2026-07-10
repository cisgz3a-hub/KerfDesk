// fit-cubics — least-squares G1 cubic Bézier fitting over measured boundary
// points (research brief #2, rec 1). On sub-pixel boundaries the FIT is the
// fairing: least squares averages ~0.1px measurement noise into fair curves,
// with no chord-replacement joints (the flattener's failure mode) and no
// per-vertex facets (Douglas-Peucker's). Algorithm follows Schneider's
// published Graphics Gems method (permissive license; math re-derived here):
// chord-length parameterization → tangent-constrained least squares for the
// two control-arm lengths → Newton-Raphson reparameterization → split at the
// worst point and recurse. Corners segment the chain and stay exact.
//
// Pure core — no I/O, no globals, deterministic.

import type { Vec2 } from '../scene';

export type CubicBezier = {
  readonly p0: Vec2;
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
};

// Newton reparameterization is worthwhile only when the first fit is already
// close (Schneider's heuristic: within 4x tolerance).
const REPARAM_TOLERANCE_FACTOR = 4;
const MAX_REPARAM_PASSES = 4;
// Arm-length degeneracy guard, as a fraction of segment chord length.
const MIN_ARM_FRACTION = 1e-6;
// One-sided / centered tangent estimation reach, in points.
const TANGENT_REACH_POINTS = 3;
// Output sampling: ~one vertex per this many px of curve, with a floor so
// short curves still render round.
const SAMPLE_STEP_PX = 1.5;
const MIN_SEGMENT_SAMPLES = 4;

/** Fit G1 cubics through the chain, segmenting at `corners` (by object
 *  reference, like every corner-aware stage). Closed cornerless chains seam
 *  at index 0 with a wrapped centered tangent, so the seam stays G1. */
export function fitCubicsThroughPoints(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
  tolerancePx: number,
): CubicBezier[] {
  if (points.length < 2) return [];
  const runs = segmentRuns(points, closed, corners);
  const out: CubicBezier[] = [];
  for (const run of runs) {
    fitRun(run, tolerancePx, out);
  }
  return out;
}

/** Sample fitted cubics back into a polyline. Each segment contributes its
 *  start point and interior samples; the final end point is appended only on
 *  open chains (a closed ring wraps to its first point downstream). */
export function sampleCubics(cubics: ReadonlyArray<CubicBezier>, closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  for (const cubic of cubics) {
    const steps = sampleCount(cubic);
    for (let s = 0; s < steps; s += 1) {
      out.push(evaluateCubic(cubic, s / steps));
    }
  }
  const last = cubics[cubics.length - 1];
  if (!closed && last !== undefined) out.push({ x: last.p3.x, y: last.p3.y });
  return out;
}

// ——— segmentation ———

// A run of consecutive points between corners (inclusive endpoints). Closed
// chains rotate so runs never straddle the seam; cornerless closed chains
// become one run that wraps (first point repeated at the end).
function segmentRuns(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  corners: ReadonlySet<Vec2>,
): Vec2[][] {
  const cornerIndices: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (corners.has(points[i] as Vec2)) cornerIndices.push(i);
  }
  if (!closed) {
    const bounds = [0, ...cornerIndices.filter((i) => i > 0 && i < points.length - 1)];
    bounds.push(points.length - 1);
    return runsFromBounds(points, bounds);
  }
  if (cornerIndices.length === 0) {
    return [[...points, points[0] as Vec2]];
  }
  const first = cornerIndices[0] as number;
  const rotated = [...points.slice(first), ...points.slice(0, first)];
  const rotatedCorners = cornerIndices.map((i) => (i - first + points.length) % points.length);
  rotatedCorners.push(points.length);
  const ring = [...rotated, rotated[0] as Vec2];
  return runsFromBounds(ring, [0, ...rotatedCorners.slice(1)]);
}

function runsFromBounds(points: ReadonlyArray<Vec2>, bounds: ReadonlyArray<number>): Vec2[][] {
  const runs: Vec2[][] = [];
  for (let b = 0; b + 1 < bounds.length; b += 1) {
    const from = bounds[b] as number;
    const to = bounds[b + 1] as number;
    if (to > from) runs.push(points.slice(from, to + 1) as Vec2[]);
  }
  return runs;
}

// ——— recursive fitting ———

function fitRun(run: ReadonlyArray<Vec2>, tolerancePx: number, out: CubicBezier[]): void {
  const tangentStart = chordTangent(run, 'start');
  const tangentEnd = chordTangent(run, 'end');
  fitRecursive(run, 0, run.length - 1, tangentStart, tangentEnd, tolerancePx, out, 0);
}

const MAX_SPLIT_DEPTH = 24;

function fitRecursive(
  points: ReadonlyArray<Vec2>,
  first: number,
  last: number,
  tangentStart: Vec2,
  tangentEnd: Vec2,
  tolerancePx: number,
  out: CubicBezier[],
  depth: number,
): void {
  const p0 = points[first] as Vec2;
  const p3 = points[last] as Vec2;
  if (last - first === 1 || depth >= MAX_SPLIT_DEPTH) {
    out.push(heuristicCubic(p0, p3, tangentStart, tangentEnd));
    return;
  }
  const u = chordParameterize(points, first, last);
  let cubic = generateBezier(points, first, last, u, tangentStart, tangentEnd);
  let error = maxFitError(points, first, last, cubic, u);
  if (error.maxSq <= tolerancePx * tolerancePx) {
    out.push(cubic);
    return;
  }
  if (error.maxSq <= tolerancePx * tolerancePx * REPARAM_TOLERANCE_FACTOR * REPARAM_TOLERANCE_FACTOR) {
    for (let pass = 0; pass < MAX_REPARAM_PASSES; pass += 1) {
      reparameterize(points, first, last, cubic, u);
      cubic = generateBezier(points, first, last, u, tangentStart, tangentEnd);
      error = maxFitError(points, first, last, cubic, u);
      if (error.maxSq <= tolerancePx * tolerancePx) {
        out.push(cubic);
        return;
      }
    }
  }
  const split = Math.min(Math.max(error.worstIndex, first + 1), last - 1);
  // The centered tangent points FORWARD along the chain; end tangents in
  // this parameterization point BACKWARD (P2 extends from P3 toward the
  // curve), so the left half ends with the negated tangent while the right
  // half starts with it as-is — G1 across the split by construction.
  const centered = centeredTangent(points, split);
  fitRecursive(points, first, split, tangentStart, negate(centered), tolerancePx, out, depth + 1);
  fitRecursive(points, split, last, centered, tangentEnd, tolerancePx, out, depth + 1);
}

// The least-squares core: with P1 = P0 + a_l*t1 and P2 = P3 + a_r*t2, solve
// the 2x2 normal equations for the arm lengths.
function generateBezier(
  points: ReadonlyArray<Vec2>,
  first: number,
  last: number,
  u: ReadonlyArray<number>,
  t1: Vec2,
  t2: Vec2,
): CubicBezier {
  const p0 = points[first] as Vec2;
  const p3 = points[last] as Vec2;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = first; i <= last; i += 1) {
    const t = u[i - first] as number;
    const b0 = (1 - t) ** 3;
    const b1 = 3 * t * (1 - t) ** 2;
    const b2 = 3 * t * t * (1 - t);
    const b3 = t ** 3;
    const a0x = t1.x * b1;
    const a0y = t1.y * b1;
    const a1x = t2.x * b2;
    const a1y = t2.y * b2;
    const p = points[i] as Vec2;
    const rx = p.x - (p0.x * (b0 + b1) + p3.x * (b2 + b3));
    const ry = p.y - (p0.y * (b0 + b1) + p3.y * (b2 + b3));
    c00 += a0x * a0x + a0y * a0y;
    c01 += a0x * a1x + a0y * a1y;
    c11 += a1x * a1x + a1y * a1y;
    x0 += a0x * rx + a0y * ry;
    x1 += a1x * rx + a1y * ry;
  }
  const det = c00 * c11 - c01 * c01;
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  let armL = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let armR = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  if (armL < MIN_ARM_FRACTION * chord || armR < MIN_ARM_FRACTION * chord) {
    armL = chord / 3;
    armR = chord / 3;
  }
  return {
    p0,
    p1: { x: p0.x + t1.x * armL, y: p0.y + t1.y * armL },
    p2: { x: p3.x + t2.x * armR, y: p3.y + t2.y * armR },
    p3,
  };
}

function maxFitError(
  points: ReadonlyArray<Vec2>,
  first: number,
  last: number,
  cubic: CubicBezier,
  u: ReadonlyArray<number>,
): { maxSq: number; worstIndex: number } {
  let maxSq = 0;
  let worstIndex = (first + last) >> 1;
  for (let i = first + 1; i < last; i += 1) {
    const q = evaluateCubic(cubic, u[i - first] as number);
    const p = points[i] as Vec2;
    const dSq = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dSq > maxSq) {
      maxSq = dSq;
      worstIndex = i;
    }
  }
  return { maxSq, worstIndex };
}

// One Newton-Raphson step per interior point:
// u -= (Q(u)-P)·Q'(u) / (|Q'(u)|² + (Q(u)-P)·Q''(u))
function reparameterize(
  points: ReadonlyArray<Vec2>,
  first: number,
  last: number,
  cubic: CubicBezier,
  u: number[],
): void {
  for (let i = first + 1; i < last; i += 1) {
    const t = u[i - first] as number;
    const p = points[i] as Vec2;
    const q = evaluateCubic(cubic, t);
    const d1 = cubicDerivative(cubic, t);
    const d2 = cubicSecondDerivative(cubic, t);
    const numerator = (q.x - p.x) * d1.x + (q.y - p.y) * d1.y;
    const denominator = d1.x * d1.x + d1.y * d1.y + (q.x - p.x) * d2.x + (q.y - p.y) * d2.y;
    if (Math.abs(denominator) < 1e-12) continue;
    const next = t - numerator / denominator;
    if (next > 0 && next < 1) u[i - first] = next;
  }
}

// ——— geometry helpers ———

function chordParameterize(points: ReadonlyArray<Vec2>, first: number, last: number): number[] {
  const u: number[] = [0];
  for (let i = first + 1; i <= last; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    u.push((u[u.length - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = u[u.length - 1] as number;
  if (total <= 0) return u.map((_, i) => i / Math.max(1, u.length - 1));
  return u.map((v) => v / total);
}

function chordTangent(run: ReadonlyArray<Vec2>, side: 'start' | 'end'): Vec2 {
  const n = run.length;
  const reach = Math.min(TANGENT_REACH_POINTS, n - 1);
  const from = side === 'start' ? (run[0] as Vec2) : (run[n - 1] as Vec2);
  const to = side === 'start' ? (run[reach] as Vec2) : (run[n - 1 - reach] as Vec2);
  return normalize({ x: to.x - from.x, y: to.y - from.y });
}

function centeredTangent(points: ReadonlyArray<Vec2>, i: number): Vec2 {
  const prev = points[Math.max(0, i - 1)] as Vec2;
  const next = points[Math.min(points.length - 1, i + 1)] as Vec2;
  return normalize({ x: next.x - prev.x, y: next.y - prev.y });
}

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  if (len < 1e-12) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function negate(v: Vec2): Vec2 {
  return { x: -v.x, y: -v.y };
}

function heuristicCubic(p0: Vec2, p3: Vec2, t1: Vec2, t2: Vec2): CubicBezier {
  const arm = Math.hypot(p3.x - p0.x, p3.y - p0.y) / 3;
  return {
    p0,
    p1: { x: p0.x + t1.x * arm, y: p0.y + t1.y * arm },
    p2: { x: p3.x + t2.x * arm, y: p3.y + t2.y * arm },
    p3,
  };
}

function evaluateCubic(c: CubicBezier, t: number): Vec2 {
  const m = 1 - t;
  const b0 = m * m * m;
  const b1 = 3 * t * m * m;
  const b2 = 3 * t * t * m;
  const b3 = t * t * t;
  return {
    x: b0 * c.p0.x + b1 * c.p1.x + b2 * c.p2.x + b3 * c.p3.x,
    y: b0 * c.p0.y + b1 * c.p1.y + b2 * c.p2.y + b3 * c.p3.y,
  };
}

function cubicDerivative(c: CubicBezier, t: number): Vec2 {
  const m = 1 - t;
  return {
    x: 3 * m * m * (c.p1.x - c.p0.x) + 6 * m * t * (c.p2.x - c.p1.x) + 3 * t * t * (c.p3.x - c.p2.x),
    y: 3 * m * m * (c.p1.y - c.p0.y) + 6 * m * t * (c.p2.y - c.p1.y) + 3 * t * t * (c.p3.y - c.p2.y),
  };
}

function cubicSecondDerivative(c: CubicBezier, t: number): Vec2 {
  const m = 1 - t;
  return {
    x: 6 * m * (c.p2.x - 2 * c.p1.x + c.p0.x) + 6 * t * (c.p3.x - 2 * c.p2.x + c.p1.x),
    y: 6 * m * (c.p2.y - 2 * c.p1.y + c.p0.y) + 6 * t * (c.p3.y - 2 * c.p2.y + c.p1.y),
  };
}

function sampleCount(cubic: CubicBezier): number {
  const polygonLength =
    Math.hypot(cubic.p1.x - cubic.p0.x, cubic.p1.y - cubic.p0.y) +
    Math.hypot(cubic.p2.x - cubic.p1.x, cubic.p2.y - cubic.p1.y) +
    Math.hypot(cubic.p3.x - cubic.p2.x, cubic.p3.y - cubic.p2.y);
  return Math.max(MIN_SEGMENT_SAMPLES, Math.ceil(polygonLength / SAMPLE_STEP_PX));
}
