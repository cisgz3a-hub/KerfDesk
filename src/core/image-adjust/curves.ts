// Curves adjustment LUT (ADR-242, parity plan PP-E): monotone cubic Hermite
// (Fritsch–Carlson) through the user's control points. Monotone segments
// never overshoot, so a rising curve cannot produce the inverted-tone
// artifacts a plain Catmull-Rom spline gives near steep points.

import { LUT_SIZE, MAX_BYTE } from './lut';

export type CurvePoint = {
  /** Input tone 0..255. */
  readonly x: number;
  /** Output tone 0..255. */
  readonly y: number;
};

// Fritsch–Carlson limiter: tangents whose α²+β² exceed 9 are scaled back to
// the monotonicity circle of radius 3.
const LIMIT_RADIUS_SQ = 9;
const LIMIT_RADIUS = 3;

/**
 * Build a 256-entry LUT through the control points. Points are sorted by x
 * and deduplicated (last y wins for a repeated x); the curve extends flat
 * beyond the outermost points, matching Photoshop.
 */
export function curveLut(points: readonly CurvePoint[]): Uint8Array {
  const { xs, ys } = sortedUnique(points);
  const lut = new Uint8Array(LUT_SIZE);
  if (xs.length === 0) {
    for (let i = 0; i < LUT_SIZE; i += 1) lut[i] = i;
    return lut;
  }
  if (xs.length === 1) {
    lut.fill(clampByte(ys[0] ?? 0));
    return lut;
  }
  const tangents = monotoneTangents(xs, ys);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    lut[i] = clampByte(Math.round(evalCurve(xs, ys, tangents, i)));
  }
  return lut;
}

function sortedUnique(points: readonly CurvePoint[]): { xs: number[]; ys: number[] } {
  const sorted = [...points].sort((a, b) => a.x - b.x);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of sorted) {
    const x = clampByte(Math.round(point.x));
    const y = clampByte(point.y);
    if (xs.length > 0 && xs[xs.length - 1] === x) {
      ys[ys.length - 1] = y;
    } else {
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs, ys };
}

function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const secants: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    secants.push(((ys[i + 1] ?? 0) - (ys[i] ?? 0)) / ((xs[i + 1] ?? 0) - (xs[i] ?? 0)));
  }
  const tangents: number[] = [secants[0] ?? 0];
  for (let i = 1; i < n - 1; i += 1) {
    const prev = secants[i - 1] ?? 0;
    const next = secants[i] ?? 0;
    tangents.push(prev * next <= 0 ? 0 : (prev + next) / 2);
  }
  tangents.push(secants[n - 2] ?? 0);
  applyLimiter(secants, tangents);
  return tangents;
}

function applyLimiter(secants: readonly number[], tangents: number[]): void {
  for (let i = 0; i < secants.length; i += 1) {
    const secant = secants[i] ?? 0;
    if (secant === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = (tangents[i] ?? 0) / secant;
    const beta = (tangents[i + 1] ?? 0) / secant;
    const sq = alpha * alpha + beta * beta;
    if (sq > LIMIT_RADIUS_SQ) {
      const tau = LIMIT_RADIUS / Math.sqrt(sq);
      tangents[i] = tau * alpha * secant;
      tangents[i + 1] = tau * beta * secant;
    }
  }
}

// Indexing helper: the arrays are dense and the callers stay inside bounds,
// but noUncheckedIndexedAccess needs the fallback spelled out somewhere.
function at(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

function evalCurve(
  xs: readonly number[],
  ys: readonly number[],
  tangents: readonly number[],
  x: number,
): number {
  const n = xs.length;
  if (x <= at(xs, 0)) return at(ys, 0);
  if (x >= at(xs, n - 1)) return at(ys, n - 1);
  let seg = 0;
  while (seg < n - 2 && at(xs, seg + 1) < x) seg += 1;
  const segment = {
    y0: at(ys, seg),
    y1: at(ys, seg + 1),
    m0: at(tangents, seg),
    m1: at(tangents, seg + 1),
  };
  return hermite(segment, at(xs, seg), at(xs, seg + 1), x);
}

type HermiteSegment = { y0: number; y1: number; m0: number; m1: number };

function hermite(seg: HermiteSegment, x0: number, x1: number, x: number): number {
  const h = x1 - x0;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * seg.y0 +
    (t3 - 2 * t2 + t) * h * seg.m0 +
    (-2 * t3 + 3 * t2) * seg.y1 +
    (t3 - t2) * h * seg.m1
  );
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(MAX_BYTE, value));
}
