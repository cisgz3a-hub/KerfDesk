// A DXF SPLINE may carry only fit points (codes 11/21, count 74) and no control
// points: AutoCAD and BricsCAD build the curve themselves, and ezdxf's
// add_spline(fit_points) writes exactly that (audit O2-P2-1). The curve here
// is the C2 cubic through every fit point with chord-length parameters, the
// standard global interpolation (Piegl & Tiller section 9.2). A CAD program's
// own end conditions may shape the curve slightly differently between fit
// points; it always passes through them.

import type { Vec2 } from '../../core/scene';
import type { SplineData } from './dxf-spline';

const DEGENERATE_CHORD = 1e-12;

export type FitSplineInput = {
  readonly fitPoints: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  /** Start and end tangent directions (codes 12/22, 13/23) when the file gives them. */
  readonly startTangent: Vec2 | null;
  readonly endTangent: Vec2 | null;
};

/**
 * The interpolating cubic as a clamped B-spline whose interior knots have full
 * multiplicity, so every span is the exact Bezier of one Hermite piece. Null
 * when fewer than two distinct fit points remain.
 */
export function fitPointSpline(input: FitSplineInput): SplineData | null {
  const points = distinctPoints(input.fitPoints, input.closed);
  if (points.length < 2) return null;
  const closed = input.closed && points.length >= 3;
  const chords = chordLengths(points, closed);
  const tangents = closed
    ? periodicTangents(points, chords)
    : openTangents(points, chords, input.startTangent, input.endTangent);
  const pieces = chords.length;
  const controlPoints: Vec2[] = [points[0] as Vec2];
  for (let i = 0; i < pieces; i += 1) {
    const from = points[i] as Vec2;
    const to = points[(i + 1) % points.length] as Vec2;
    const h = chords[i] as number;
    const d0 = tangents[i] as Vec2;
    const d1 = tangents[(i + 1) % tangents.length] as Vec2;
    controlPoints.push(
      { x: from.x + (d0.x * h) / 3, y: from.y + (d0.y * h) / 3 },
      { x: to.x - (d1.x * h) / 3, y: to.y - (d1.y * h) / 3 },
      to,
    );
  }
  const knots = [0, 0, 0, 0];
  for (let i = 1; i < pieces; i += 1) knots.push(i, i, i);
  knots.push(pieces, pieces, pieces, pieces);
  return { degree: 3, knots, controlPoints, weights: [], closed };
}

function distinctPoints(points: ReadonlyArray<Vec2>, closed: boolean): Vec2[] {
  const kept: Vec2[] = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last === undefined || distance(last, point) > DEGENERATE_CHORD) kept.push(point);
  }
  // A closed spline that repeats its first fit point at the end.
  if (
    closed &&
    kept.length > 2 &&
    distance(kept[0] as Vec2, kept.at(-1) as Vec2) <= DEGENERATE_CHORD
  )
    kept.pop();
  return kept;
}

function chordLengths(points: ReadonlyArray<Vec2>, closed: boolean): number[] {
  const count = closed ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, i) =>
    distance(points[i] as Vec2, points[(i + 1) % points.length] as Vec2),
  );
}

// First derivatives (per unit of chord-length parameter) at each fit point of
// the C2 cubic; each row is h[i] D[i-1] + 2 (h[i-1] + h[i]) D[i] + h[i-1] D[i+1]
// = 3 (h[i] (P[i] - P[i-1]) / h[i-1] + h[i-1] (P[i+1] - P[i]) / h[i]).
function interiorRow(points: ReadonlyArray<Vec2>, chords: ReadonlyArray<number>, i: number) {
  const n = points.length;
  const before = chords[(i - 1 + chords.length) % chords.length] as number;
  const after = chords[i % chords.length] as number;
  const previous = points[(i - 1 + n) % n] as Vec2;
  const current = points[i] as Vec2;
  const next = points[(i + 1) % n] as Vec2;
  const rhs = (axis: 'x' | 'y') =>
    3 *
    ((after * (current[axis] - previous[axis])) / before +
      (before * (next[axis] - current[axis])) / after);
  return { lower: after, diagonal: 2 * (before + after), upper: before, x: rhs('x'), y: rhs('y') };
}

function openTangents(
  points: ReadonlyArray<Vec2>,
  chords: ReadonlyArray<number>,
  startTangent: Vec2 | null,
  endTangent: Vec2 | null,
): Vec2[] {
  const n = points.length;
  const lower: number[] = [];
  const diagonal: number[] = [];
  const upper: number[] = [];
  const rx: number[] = [];
  const ry: number[] = [];
  const end = (index: number, neighbour: number, tangent: Vec2 | null) => {
    const unit = tangent === null ? null : unitVector(tangent);
    if (unit !== null) return { diagonal: 1, off: 0, x: unit.x, y: unit.y };
    // Natural end: zero second derivative.
    const a = points[Math.min(index, neighbour)] as Vec2;
    const b = points[Math.max(index, neighbour)] as Vec2;
    const h = chords[Math.min(index, neighbour)] as number;
    return { diagonal: 2, off: 1, x: (3 * (b.x - a.x)) / h, y: (3 * (b.y - a.y)) / h };
  };
  const first = end(0, 1, startTangent);
  lower.push(0);
  diagonal.push(first.diagonal);
  upper.push(first.off);
  rx.push(first.x);
  ry.push(first.y);
  for (let i = 1; i < n - 1; i += 1) {
    const row = interiorRow(points, chords, i);
    lower.push(row.lower);
    diagonal.push(row.diagonal);
    upper.push(row.upper);
    rx.push(row.x);
    ry.push(row.y);
  }
  const last = end(n - 1, n - 2, endTangent);
  lower.push(last.off);
  diagonal.push(last.diagonal);
  upper.push(0);
  rx.push(last.x);
  ry.push(last.y);
  const xs = solveTridiagonal(lower, diagonal, upper, rx);
  const ys = solveTridiagonal(lower, diagonal, upper, ry);
  return xs.map((x, i) => ({ x, y: ys[i] as number }));
}

function periodicTangents(points: ReadonlyArray<Vec2>, chords: ReadonlyArray<number>): Vec2[] {
  const rows = points.map((_, i) => interiorRow(points, chords, i));
  const lower = rows.map((row) => row.lower);
  const diagonal = rows.map((row) => row.diagonal);
  const upper = rows.map((row) => row.upper);
  const xs = solveCyclic(
    lower,
    diagonal,
    upper,
    rows.map((row) => row.x),
  );
  const ys = solveCyclic(
    lower,
    diagonal,
    upper,
    rows.map((row) => row.y),
  );
  return xs.map((x, i) => ({ x, y: ys[i] as number }));
}

// Thomas algorithm; lower[0] and upper[n-1] are unused. The systems here are
// strictly diagonally dominant, so no pivoting is needed.
function solveTridiagonal(
  lower: ReadonlyArray<number>,
  diagonal: ReadonlyArray<number>,
  upper: ReadonlyArray<number>,
  rhs: ReadonlyArray<number>,
): number[] {
  const n = diagonal.length;
  const c: number[] = new Array<number>(n).fill(0);
  const d: number[] = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    const denominator =
      (diagonal[i] as number) - (i > 0 ? (lower[i] as number) * (c[i - 1] as number) : 0);
    c[i] = (upper[i] as number) / denominator;
    d[i] =
      ((rhs[i] as number) - (i > 0 ? (lower[i] as number) * (d[i - 1] as number) : 0)) /
      denominator;
  }
  const x: number[] = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1)
    x[i] = (d[i] as number) - (c[i] as number) * (i < n - 1 ? (x[i + 1] as number) : 0);
  return x;
}

// Cyclic tridiagonal system (lower[0] couples to the last unknown, upper[n-1]
// to the first) by the Sherman-Morrison correction of two Thomas solves.
function solveCyclic(
  lower: ReadonlyArray<number>,
  diagonal: ReadonlyArray<number>,
  upper: ReadonlyArray<number>,
  rhs: ReadonlyArray<number>,
): number[] {
  const n = diagonal.length;
  const alpha = upper[n - 1] as number;
  const beta = lower[0] as number;
  const gamma = -(diagonal[0] as number);
  const modified = [...diagonal];
  modified[0] = (diagonal[0] as number) - gamma;
  modified[n - 1] = (diagonal[n - 1] as number) - (alpha * beta) / gamma;
  const x = solveTridiagonal(lower, modified, upper, rhs);
  const u = Array.from({ length: n }, (_, i) => (i === 0 ? gamma : i === n - 1 ? alpha : 0));
  const z = solveTridiagonal(lower, modified, upper, u);
  const factor =
    ((x[0] as number) + (beta * (x[n - 1] as number)) / gamma) /
    (1 + (z[0] as number) + (beta * (z[n - 1] as number)) / gamma);
  return x.map((value, i) => value - factor * (z[i] as number));
}

function unitVector(vector: Vec2): Vec2 | null {
  const length = Math.hypot(vector.x, vector.y);
  return length > DEGENERATE_CHORD ? { x: vector.x / length, y: vector.y / length } : null;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
