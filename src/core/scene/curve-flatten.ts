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
// chords whose ends lie on the curve). That many chords at equal parameter
// steps are used when they all fit (always for a circular arc); otherwise the
// last two greedy chords are evened out so no sliver is left at the end. The
// first point of a segment is its start and the last is its end, exactly.

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
// A fitting chord whose error reaches this share of the tolerance is long
// enough: its length is within about 1% of the longest (error grows with the
// square of a short chord's length).
const ACCEPT_SHARE = 0.98;
// The search aims a little under the tolerance so a model step usually fits.
const AIM_SHARE = 0.99;
// The search ends once the unknown gap is this share of the chord.
const STEP_REFINEMENT = 2 ** -8;
const MAX_PROBES = 96;
// Steps, and the error difference that ends them, evening out the last two chords.
const PAIR_STEPS = 12;
const PAIR_BALANCE = 0.02;

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
  if (!allFinite([from, segment.control1, segment.control2, segment.to])) return null;
  return fewestChords(cubicCurve(from, segment), tolerance, budget);
}

export function flattenEllipseChords(
  from: Vec2,
  to: Vec2,
  arc: ChordEllipse,
  tolerance: number,
  budget: number,
): Vec2[] | null {
  const angles = [arc.radiusX, arc.radiusY, arc.rotationRad, arc.theta1, arc.delta];
  if (!allFinite([from, to, arc.center]) || !angles.every(Number.isFinite)) return null;
  return fewestChords(ellipseCurve(from, to, arc), tolerance, budget);
}

// Geometry that is not finite has no chord error. It is refused (the caller
// reports the segment budget exceeded), never drawn as one straight move.
function allFinite(points: ReadonlyArray<Vec2>): boolean {
  return points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
}

function fewestChords(curve: ChordCurve, tolerance: number, budget: number): Vec2[] | null {
  const chords = greedyChords(curve, tolerance, budget);
  if (chords === null) return null;
  if (chords.points.length < 2) return chords.points;
  const even = evenChords(curve, chords.points.length, tolerance);
  if (even !== null) return even;
  balanceLastPair(curve, chords, tolerance);
  return chords.points;
}

/**
 * The same number of chords at equal parameter steps, when every one fits.
 * A circular arc always does (its chord error depends only on the step), and
 * equal steps flatten a curve and its reverse to the same vertices.
 */
function evenChords(curve: ChordCurve, count: number, tolerance: number): Vec2[] | null {
  const points: Vec2[] = [];
  let from = curve.start;
  for (let index = 1; index <= count; index += 1) {
    const t = index / count;
    const to = index === count ? curve.end : curve.point(t);
    if (!(curve.chordError((index - 1) / count, t, from, to) <= tolerance)) return null;
    points.push(to);
    from = to;
  }
  return points;
}

type Chords = { readonly points: Vec2[]; readonly ends: number[] };

/** Longest fitting chord from each point; null when more than `limit` chords. */
function greedyChords(curve: ChordCurve, tolerance: number, limit: number): Chords | null {
  const points: Vec2[] = [];
  const ends: number[] = [];
  let t0 = 0;
  let from = curve.start;
  let step = 1;
  while (t0 < 1) {
    if (points.length >= limit) return null;
    const t1 = longestFit(curve, t0, from, step, tolerance);
    if (Number.isNaN(t1)) return null;
    const to = t1 >= 1 ? curve.end : curve.point(t1);
    points.push(to);
    ends.push(t1);
    step = t1 - t0;
    t0 = t1;
    from = to;
  }
  return { points, ends };
}

/**
 * The greedy walk leaves whatever is left for its last chord, often a sliver.
 * Move the vertex before it to where the last two chords' errors are equal,
 * so neither is short. The first error grows and the second shrinks as the
 * vertex moves on, and the square root of each is close to linear in the
 * chord's length, so false position (Illinois variant) on the difference of
 * the square roots finds it in a few steps. Both chords are checked, the
 * count is unchanged, and the greedy vertex stays unless a split is better.
 */
function balanceLastPair(curve: ChordCurve, chords: Chords, tolerance: number): void {
  const count = chords.points.length;
  if (count < 2) return;
  const t0 = count > 2 ? (chords.ends[count - 3] as number) : 0;
  const from = count > 2 ? (chords.points[count - 3] as Vec2) : curve.start;
  const split = (t: number): Split => {
    const point = curve.point(t);
    const first = curve.chordError(t0, t, from, point);
    const second = curve.chordError(t, 1, point, curve.end);
    return { t, point, first, second, gap: Math.sqrt(first) - Math.sqrt(second) };
  };
  let best = split(chords.ends[count - 2] as number);
  let high = { t: best.t, gap: best.gap };
  let low = { t: t0, gap: -Math.sqrt(curve.chordError(t0, 1, from, curve.end)) };
  let side = 0;
  for (let step = 0; step < PAIR_STEPS; step += 1) {
    if (!(high.gap > 0 && low.gap < 0)) break;
    const next = split((low.t * high.gap - high.t * low.gap) / (high.gap - low.gap));
    if (fitsBetter(next, best, tolerance)) best = next;
    if (Math.abs(next.first - next.second) <= PAIR_BALANCE * tolerance) break;
    if (next.gap < 0) {
      low = { t: next.t, gap: next.gap };
      if (side < 0) high = { t: high.t, gap: high.gap / 2 };
      side = -1;
    } else {
      high = { t: next.t, gap: next.gap };
      if (side > 0) low = { t: low.t, gap: low.gap / 2 };
      side = 1;
    }
  }
  chords.points[count - 2] = best.point;
  chords.ends[count - 2] = best.t;
}

type Split = {
  readonly t: number;
  readonly point: Vec2;
  readonly first: number;
  readonly second: number;
  readonly gap: number;
};

function fitsBetter(candidate: Split, current: Split, tolerance: number): boolean {
  const worst = Math.max(candidate.first, candidate.second);
  return worst <= tolerance && worst < Math.max(current.first, current.second);
}

/**
 * The end t1 in (t0, 1] of a chord from `from` that fits and is nearly the
 * longest that does. Probes follow the square-law model of the error from
 * the previous probe, kept inside the bracket of the longest fitting and the
 * shortest failing end found so far, and bisect when the model leaves it.
 * NaN when a chord error is not finite (overflow): the caller refuses.
 */
function longestFit(
  curve: ChordCurve,
  t0: number,
  from: Vec2,
  guess: number,
  tolerance: number,
): number {
  let low = t0;
  let high = Infinity;
  let probe = Math.min(1, t0 + guess);
  for (let count = 0; count < MAX_PROBES; count += 1) {
    const error = chordErrorTo(curve, t0, probe, from);
    if (!Number.isFinite(error)) return Number.NaN;
    const fit = error <= tolerance;
    if (fit) low = probe;
    else high = probe;
    if (fit && (probe >= 1 || !(error < tolerance * ACCEPT_SHARE))) return probe;
    if (!fit && probe - t0 <= MIN_PARAMETER_STEP) return probe;
    if (high - low <= (low - t0) * STEP_REFINEMENT) return low;
    probe = nextProbe(t0, probe, error, tolerance, low, high);
  }
  return low > t0 ? low : Math.min(1, t0 + MIN_PARAMETER_STEP);
}

function nextProbe(
  t0: number,
  probe: number,
  error: number,
  tolerance: number,
  low: number,
  high: number,
): number {
  const ratio = error > 0 ? Math.sqrt((tolerance * AIM_SHARE) / error) : 4;
  const modelled = t0 + (probe - t0) * Math.min(4, Math.max(0.25, ratio));
  const upper = Math.min(high, 1);
  if (modelled > low && modelled < upper) return modelled;
  if (high === Infinity) return Math.min(1, t0 + 4 * (low - t0));
  return (low + high) / 2;
}

function chordErrorTo(curve: ChordCurve, t0: number, t1: number, from: Vec2): number {
  return curve.chordError(t0, t1, from, t1 >= 1 ? curve.end : curve.point(t1));
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
