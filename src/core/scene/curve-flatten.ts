// Chord-optimal flattening of cubic and elliptical-arc segments (ADR-414).
//
// Every chord is accepted only when the true largest distance between the
// curve piece it replaces and the chord segment is within the tolerance. That
// distance is computed, not estimated from control points: the offset of the
// curve from the chord's line and its position along the chord are a cubic
// polynomial (Bezier) or a sinusoid (ellipse) in the curve parameter, so their
// extremes lie at the ends or at the roots of a quadratic (or at one closed
// form angle pair). A piece that runs past either end of its chord adds that
// overrun, so the bound holds against the segment, not only its line.
//
// Each piece takes the longest chord that fits (a greedy walk over the curve
// parameter; with a monotone fit test the greedy count is the minimum for
// chords whose ends lie on the curve), then a bisection on the tolerance finds
// the smallest error that still needs that many chords, so the chords share
// the error evenly instead of leaving a short last chord. The first point of
// a segment is its start and the last is its end, exactly.

import type { CubicPathSegment, Vec2 } from './scene-object';

/** Parametric piece on t in [0, 1] with an exact chord-error measure. */
type ChordCurve = {
  readonly start: Vec2;
  readonly end: Vec2;
  point(t: number): Vec2;
  /** Largest distance from the curve on [t0, t1] to the segment a-b. */
  chordError(t0: number, t1: number, a: Vec2, b: Vec2): number;
};

/** One-parameter extreme finder: values at the ends and interior critical points. */
type Extremes = { min: number; max: number };

// A step below this many parameter units is accepted without a fit test, the
// same floor as the depth-24 cap of the midpoint subdivision it replaces.
const MIN_PARAMETER_STEP = 2 ** -24;
// The chord end is placed to within this fraction of its own parameter length.
const STEP_REFINEMENT = 2 ** -10;
// Bisection steps on the shared error once the chord count is known.
const BALANCE_STEPS = 8;

export type ChordEllipse = {
  readonly center: Vec2;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationRad: number;
  readonly theta1: number;
  readonly delta: number;
};

export function flattenCubicChords(
  from: Vec2,
  segment: CubicPathSegment,
  tolerance: number,
  budget: number,
): Vec2[] | null {
  return fewestChords(cubicCurve(from, segment), tolerance, budget);
}

export function flattenEllipseChords(
  from: Vec2,
  to: Vec2,
  arc: ChordEllipse,
  tolerance: number,
  budget: number,
): Vec2[] | null {
  return fewestChords(ellipseCurve(from, to, arc), tolerance, budget);
}

function fewestChords(curve: ChordCurve, tolerance: number, budget: number): Vec2[] | null {
  const first = greedyChords(curve, tolerance, budget);
  if (first === null || first.length <= 1) return first;
  const count = first.length;
  let best = first;
  let low = 0;
  let high = tolerance;
  for (let step = 0; step < BALANCE_STEPS; step += 1) {
    const middle = (low + high) / 2;
    const candidate = greedyChords(curve, middle, count);
    if (candidate === null) {
      low = middle;
    } else {
      high = middle;
      best = candidate;
    }
  }
  return best;
}

/** Longest fitting chord from each point; null when more than `limit` chords. */
function greedyChords(curve: ChordCurve, tolerance: number, limit: number): Vec2[] | null {
  const out: Vec2[] = [];
  let t0 = 0;
  let from = curve.start;
  let step = 1;
  while (t0 < 1) {
    if (out.length >= limit) return null;
    if (fits(curve, t0, 1, from, curve.end, tolerance)) {
      out.push(curve.end);
      return out;
    }
    const t1 = longestFit(curve, t0, from, Math.min(step, 1 - t0), tolerance);
    const to = curve.point(t1);
    out.push(to);
    step = t1 - t0;
    t0 = t1;
    from = to;
  }
  return out;
}

/** The largest t1 in (t0, 1) whose chord fits, found from a first guess. */
function longestFit(
  curve: ChordCurve,
  t0: number,
  from: Vec2,
  guess: number,
  tolerance: number,
): number {
  const fitsAt = (t: number): boolean => fits(curve, t0, t, from, curve.point(t), tolerance);
  // Bracket: `low` fits (or is t0), `high` does not (t = 1 already failed).
  let low = t0;
  let high = 1;
  let probe = Math.min(t0 + guess, 1);
  if (probe < 1 && fitsAt(probe)) {
    low = probe;
    for (probe = t0 + 2 * (low - t0); probe < 1 && fitsAt(probe); probe = t0 + 2 * (low - t0)) {
      low = probe;
    }
    high = Math.min(probe, 1);
  } else {
    high = probe;
    for (
      probe = t0 + (high - t0) / 2;
      probe - t0 > MIN_PARAMETER_STEP;
      probe = t0 + (probe - t0) / 2
    ) {
      if (fitsAt(probe)) {
        low = probe;
        break;
      }
      high = probe;
    }
    if (low === t0) return Math.min(1, t0 + Math.max(MIN_PARAMETER_STEP, probe - t0));
  }
  while (high - low > (low - t0) * STEP_REFINEMENT) {
    const middle = (low + high) / 2;
    if (fitsAt(middle)) low = middle;
    else high = middle;
  }
  return low;
}

function fits(
  curve: ChordCurve,
  t0: number,
  t1: number,
  a: Vec2,
  b: Vec2,
  tolerance: number,
): boolean {
  const error = curve.chordError(t0, t1, a, b);
  // Non-finite geometry cannot be measured; it keeps one straight chord
  // rather than subdividing to the step floor.
  return !Number.isFinite(error) || error <= tolerance;
}

/**
 * Combine the offset from the chord's line with how far the piece runs past
 * the chord's ends. Both are exact extremes, so the result is the exact
 * largest distance when the piece stays between the ends, and an upper bound
 * (the hypotenuse of the two worst values) when it does not.
 */
function chordDistance(offset: Extremes, along: Extremes, length: number): number {
  const beside = Math.max(Math.abs(offset.min), Math.abs(offset.max));
  const overrun = Math.max(0, -along.min, along.max - length);
  return overrun === 0 ? beside : Math.hypot(beside, overrun);
}

// ---------------------------------------------------------------- cubic

function cubicCurve(from: Vec2, segment: CubicPathSegment): ChordCurve {
  const p0 = from;
  const { control1: p1, control2: p2, to: p3 } = segment;
  // Power basis about p0: P(t) - p0 = a t^3 + b t^2 + c t.
  const a = { x: p3.x - p0.x + 3 * (p1.x - p2.x), y: p3.y - p0.y + 3 * (p1.y - p2.y) };
  const b = { x: 3 * (p0.x - 2 * p1.x + p2.x), y: 3 * (p0.y - 2 * p1.y + p2.y) };
  const c = { x: 3 * (p1.x - p0.x), y: 3 * (p1.y - p0.y) };
  const point = (t: number): Vec2 => {
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    return {
      x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x,
      y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y,
    };
  };
  const derivative = (t: number): Vec2 => ({
    x: (3 * a.x * t + 2 * b.x) * t + c.x,
    y: (3 * a.y * t + 2 * b.y) * t + c.y,
  });
  const chordError = (t0: number, t1: number, start: Vec2, end: Vec2): number => {
    const ex = end.x - start.x;
    const ey = end.y - start.y;
    const length = Math.hypot(ex, ey);
    if (!(length > 0))
      return degenerateCubicError(start, end, derivative(t0), derivative(t1), t1 - t0);
    const ux = ex / length;
    const uy = ey / length;
    // Along the chord (dot with u) and beside it (cross with u), relative to start.
    const along = project(a, b, c, { x: p0.x - start.x, y: p0.y - start.y }, ux, uy);
    const beside = project(a, b, c, { x: p0.x - start.x, y: p0.y - start.y }, -uy, ux);
    return chordDistance(cubicExtremes(beside, t0, t1), cubicExtremes(along, t0, t1), length);
  };
  return { start: p0, end: p3, point, chordError };
}

type Cubic1d = readonly [number, number, number, number];

function project(a: Vec2, b: Vec2, c: Vec2, d: Vec2, vx: number, vy: number): Cubic1d {
  return [a.x * vx + a.y * vy, b.x * vx + b.y * vy, c.x * vx + c.y * vy, d.x * vx + d.y * vy];
}

function cubicExtremes(k: Cubic1d, t0: number, t1: number): Extremes {
  const value = (t: number): number => ((k[0] * t + k[1]) * t + k[2]) * t + k[3];
  let min = Math.min(value(t0), value(t1));
  let max = Math.max(value(t0), value(t1));
  for (const t of quadraticRoots(3 * k[0], 2 * k[1], k[2])) {
    if (t > t0 && t < t1) {
      const v = value(t);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
  }
  return { min, max };
}

/** Real roots of q t^2 + r t + s, stable against cancellation. */
function quadraticRoots(q: number, r: number, s: number): number[] {
  const scale = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
  if (scale === 0) return [];
  if (Math.abs(q) <= scale * 1e-12) return r === 0 ? [] : [-s / r];
  const discriminant = r * r - 4 * q * s;
  if (discriminant < 0) return [];
  const root = Math.sqrt(discriminant);
  const m = -0.5 * (r + (r >= 0 ? root : -root));
  return m === 0 ? [0] : [m / q, s / m];
}

/**
 * A chord of zero length (a closed loop or a cusp piece): the piece lies in
 * the hull of its own control points, so the farthest of them from the chord
 * point bounds its distance.
 */
function degenerateCubicError(start: Vec2, end: Vec2, d0: Vec2, d1: Vec2, span: number): number {
  const k = span / 3;
  return Math.max(
    Math.hypot(d0.x * k, d0.y * k),
    Math.hypot(end.x - d1.x * k - start.x, end.y - d1.y * k - start.y),
    Math.hypot(end.x - start.x, end.y - start.y),
  );
}

// ---------------------------------------------------------------- ellipse

function ellipseCurve(from: Vec2, to: Vec2, arc: ChordEllipse): ChordCurve {
  const cos = Math.cos(arc.rotationRad);
  const sin = Math.sin(arc.rotationRad);
  // P(theta) = center + ex cos(theta) + ey sin(theta).
  const ex = { x: arc.radiusX * cos, y: arc.radiusX * sin };
  const ey = { x: -arc.radiusY * sin, y: arc.radiusY * cos };
  const angle = (t: number): number => arc.theta1 + arc.delta * t;
  const point = (t: number): Vec2 => {
    const theta = angle(t);
    return {
      x: arc.center.x + ex.x * Math.cos(theta) + ey.x * Math.sin(theta),
      y: arc.center.y + ex.y * Math.cos(theta) + ey.y * Math.sin(theta),
    };
  };
  const chordError = (t0: number, t1: number, start: Vec2, end: Vec2): number => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0)) return Math.max(arc.radiusX, arc.radiusY) * 2;
    const ux = dx / length;
    const uy = dy / length;
    const offset = { x: arc.center.x - start.x, y: arc.center.y - start.y };
    const sinusoid = (vx: number, vy: number): Extremes =>
      sinusoidExtremes(
        offset.x * vx + offset.y * vy,
        ex.x * vx + ex.y * vy,
        ey.x * vx + ey.y * vy,
        angle(t0),
        angle(t1),
      );
    return chordDistance(sinusoid(-uy, ux), sinusoid(ux, uy), length);
  };
  return { start: from, end: to, point, chordError };
}

/** Extremes of k + p cos(theta) + q sin(theta) for theta between from and to. */
function sinusoidExtremes(k: number, p: number, q: number, from: number, to: number): Extremes {
  const value = (theta: number): number => k + p * Math.cos(theta) + q * Math.sin(theta);
  let min = Math.min(value(from), value(to));
  let max = Math.max(value(from), value(to));
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const peak = Math.atan2(q, p);
  // Critical angles are peak + n*pi; visit every one inside the sweep.
  for (let n = Math.ceil((low - peak) / Math.PI); peak + n * Math.PI < high; n += 1) {
    const v = value(peak + n * Math.PI);
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max };
}
