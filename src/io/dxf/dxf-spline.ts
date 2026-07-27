// Clean-room B-spline/NURBS sampling for DXF SPLINE entities (Phase H.6,
// RESEARCH_LOG "de Boor spline evaluation ... implemented clean-room").
// Rational splines run the same de Boor recursion on homogeneous
// (x·w, y·w, w) coordinates and divide out w at the end.

import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM, type Vec2 } from '../../core/scene';

// Sampling is adaptive to chord height, not a fixed count. A fixed
// samples-per-span is blind to curvature: the same 8 steps served a gentle
// 500 mm sweep and a 2 mm hairpin, so the error against the true curve was
// whatever the geometry happened to make it. Now each knot span is split until
// the deviation from the true curve is within tolerance, which is the contract
// the rest of the machine path already works to.
const DOMAIN_EPSILON = 1e-12;
// Every knot span is halved this many times before the flatness test is
// trusted. One probe at the midpoint can land exactly on the chord of an
// S-shaped span and stop far too early; two forced levels break that symmetry.
const MIN_SUBDIVISION_DEPTH = 2;
const MAX_SUBDIVISION_DEPTH = 12;
// Ceiling on emitted points so a pathological knot vector cannot produce an
// unbounded polyline. Raised from the old 2048 because adaptive sampling spends
// its budget where the curvature is instead of spreading it evenly.
const MAX_SPLINE_POINTS = 4096;

export type SplineData = {
  readonly degree: number;
  readonly knots: ReadonlyArray<number>;
  readonly controlPoints: ReadonlyArray<Vec2>;
  // Empty array = non-rational (all weights 1).
  readonly weights: ReadonlyArray<number>;
  readonly closed: boolean;
};

export type SampleSplineResult =
  | { readonly kind: 'ok'; readonly points: ReadonlyArray<Vec2> }
  | { readonly kind: 'error'; readonly reason: string };

export type SampleSplineOptions = {
  // Maximum allowed distance between the emitted polyline and the true curve.
  readonly toleranceMm?: number;
};

export function sampleSpline(
  spline: SplineData,
  options: SampleSplineOptions = {},
): SampleSplineResult {
  const { degree, knots, controlPoints } = spline;
  const n = controlPoints.length;
  if (degree < 1) return { kind: 'error', reason: `unsupported spline degree ${degree}` };
  if (n < degree + 1) {
    return { kind: 'error', reason: `spline needs ${degree + 1} control points, has ${n}` };
  }
  if (knots.length !== n + degree + 1) {
    return {
      kind: 'error',
      reason: `knot count ${knots.length} does not match ${n} control points at degree ${degree}`,
    };
  }
  if (spline.weights.length > 0 && spline.weights.length !== n) {
    return { kind: 'error', reason: 'weight count does not match control points' };
  }
  const domainStart = knots[degree] as number;
  const domainEnd = knots[n] as number;
  if (!(domainEnd - domainStart > DOMAIN_EPSILON)) {
    return { kind: 'error', reason: 'degenerate spline knot domain' };
  }
  const tolerance = Math.max(options.toleranceMm ?? DEFAULT_MACHINE_CURVE_TOLERANCE_MM, 1e-6);
  const points = flattenToTolerance(spline, domainStart, domainEnd, tolerance);
  return { kind: 'ok', points };
}

// Knot values are the only places a spline can lose derivative continuity, so
// they seed the subdivision. Refining across a knot would let a corner average
// away into its neighbours.
function breakpoints(spline: SplineData, domainStart: number, domainEnd: number): number[] {
  const interior = spline.knots.filter(
    (knot) => knot > domainStart + DOMAIN_EPSILON && knot < domainEnd - DOMAIN_EPSILON,
  );
  const unique = [...new Set([domainStart, ...interior, domainEnd])].sort((a, b) => a - b);
  return unique;
}

function flattenToTolerance(
  spline: SplineData,
  domainStart: number,
  domainEnd: number,
  tolerance: number,
): Vec2[] {
  const spans = breakpoints(spline, domainStart, domainEnd);
  const first = spans[0] ?? domainStart;
  const points: Vec2[] = [deBoor(spline, first, domainStart, domainEnd)];
  for (let i = 1; i < spans.length; i += 1) {
    const u0 = spans[i - 1] as number;
    const u1 = spans[i] as number;
    subdivide(spline, u0, u1, domainStart, domainEnd, tolerance, 0, points);
  }
  return points;
}

// Appends the points of (u0, u1], assuming the point at u0 is already present.
function subdivide(
  spline: SplineData,
  u0: number,
  u1: number,
  domainStart: number,
  domainEnd: number,
  tolerance: number,
  depth: number,
  out: Vec2[],
): void {
  const start = out[out.length - 1] as Vec2;
  const end = deBoor(spline, u1, domainStart, domainEnd);
  if (out.length >= MAX_SPLINE_POINTS || depth >= MAX_SUBDIVISION_DEPTH) {
    out.push(end);
    return;
  }
  const mid = (u0 + u1) / 2;
  const midPoint = deBoor(spline, mid, domainStart, domainEnd);
  if (depth >= MIN_SUBDIVISION_DEPTH && distanceToSegment(midPoint, start, end) <= tolerance) {
    out.push(end);
    return;
  }
  subdivide(spline, u0, mid, domainStart, domainEnd, tolerance, depth + 1, out);
  subdivide(spline, mid, u1, domainStart, domainEnd, tolerance, depth + 1, out);
}

// Perpendicular distance from a point to a segment, falling back to the plain
// distance when the segment has collapsed to a point - which happens on a
// closed spline whose span returns to its start.
function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= DOMAIN_EPSILON) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function deBoor(spline: SplineData, uRaw: number, domainStart: number, domainEnd: number): Vec2 {
  const { degree, knots, controlPoints, weights } = spline;
  const u = Math.min(Math.max(uRaw, domainStart), domainEnd);
  const span = findSpan(knots, degree, controlPoints.length, u);
  // Homogeneous working copies d[j] for j in 0..degree.
  const dx: number[] = [];
  const dy: number[] = [];
  const dw: number[] = [];
  for (let j = 0; j <= degree; j += 1) {
    const index = span - degree + j;
    const point = controlPoints[index] ?? { x: 0, y: 0 };
    const w = weights.length > 0 ? (weights[index] ?? 1) : 1;
    dx.push(point.x * w);
    dy.push(point.y * w);
    dw.push(w);
  }
  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const i = span - degree + j;
      const denominator = (knots[i + degree - r + 1] as number) - (knots[i] as number);
      const alpha = denominator > DOMAIN_EPSILON ? (u - (knots[i] as number)) / denominator : 0;
      dx[j] = (1 - alpha) * (dx[j - 1] as number) + alpha * (dx[j] as number);
      dy[j] = (1 - alpha) * (dy[j - 1] as number) + alpha * (dy[j] as number);
      dw[j] = (1 - alpha) * (dw[j - 1] as number) + alpha * (dw[j] as number);
    }
  }
  const w = dw[degree] as number;
  const safeW = Math.abs(w) > DOMAIN_EPSILON ? w : 1;
  return { x: (dx[degree] as number) / safeW, y: (dy[degree] as number) / safeW };
}

// Largest span index k with knots[k] <= u < knots[k+1], clamped so the
// de Boor window stays inside the control net (standard NURBS span search).
function findSpan(
  knots: ReadonlyArray<number>,
  degree: number,
  controlPointCount: number,
  u: number,
): number {
  const last = controlPointCount - 1;
  if (u >= (knots[controlPointCount] as number)) return last;
  if (u <= (knots[degree] as number)) return degree;
  let low = degree;
  let high = controlPointCount;
  let mid = Math.floor((low + high) / 2);
  while (u < (knots[mid] as number) || u >= (knots[mid + 1] as number)) {
    if (u < (knots[mid] as number)) high = mid;
    else low = mid;
    mid = Math.floor((low + high) / 2);
  }
  return mid;
}
