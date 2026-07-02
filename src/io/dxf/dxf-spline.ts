// Clean-room B-spline/NURBS sampling for DXF SPLINE entities (Phase H.6,
// RESEARCH_LOG "de Boor spline evaluation ... implemented clean-room").
// Rational splines run the same de Boor recursion on homogeneous
// (x·w, y·w, w) coordinates and divide out w at the end.

import type { Vec2 } from '../../core/scene';

const SAMPLES_PER_SPAN = 8;
const MIN_SAMPLES = 4;
const MAX_SAMPLES = 2048;
const DOMAIN_EPSILON = 1e-12;

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

export function sampleSpline(spline: SplineData): SampleSplineResult {
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
  const spans = Math.max(1, n - degree);
  const samples = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, spans * SAMPLES_PER_SPAN));
  const points: Vec2[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const u = domainStart + ((domainEnd - domainStart) * i) / samples;
    points.push(deBoor(spline, u, domainStart, domainEnd));
  }
  return { kind: 'ok', points };
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
