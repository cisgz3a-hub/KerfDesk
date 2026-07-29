// Clean-room B-spline/NURBS sampling for DXF SPLINE entities (Phase H.6,
// RESEARCH_LOG "de Boor spline evaluation ... implemented clean-room").
//
// Tolerance is certified from the convex hull of each exact Bezier subcurve,
// not inferred from samples.  A midpoint test can miss a high-degree curve
// that crosses its chord exactly at every probe.  Knot insertion gives every
// non-empty B-spline span its Bezier controls; de Casteljau then gives the
// same conservative hull for every recursively split piece.

import { DEFAULT_MACHINE_CURVE_TOLERANCE_MM, type Vec2 } from '../../core/scene';
import { flattenSplineToTolerance } from './flatten-spline-to-tolerance';

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
  const points = flattenSplineToTolerance(spline, domainStart, domainEnd, tolerance);
  return { kind: 'ok', points };
}
