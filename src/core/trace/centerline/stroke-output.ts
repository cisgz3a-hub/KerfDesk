// Finished stroke output (ADR-405): the corner set, the cubic fit and the
// registered compatibility polyline for one assembled chain.

import type { Polyline, Vec2 } from '../../scene';
import { registerTraceCurve } from '../trace-curves';
import { collectOutputCorners } from './curve-refine';
import { fitStrokeCurve, sampleStrokeCurve } from './stroke-curve-fit';

/** How finished chains become canonical cubic curves (ADR-405). */
export type StrokeCurvePolicy = {
  /** Maximum distance of the fitted curve from the faired centreline, px. */
  readonly fitTolerancePx?: number;
  /** Turn at which an unmarked simplified vertex becomes a corner. */
  readonly cornerAngleRad?: number;
  /** Sharpener-marked corners gentler than this turn are released. */
  readonly drawnCornerMinRad?: number;
  /** Every simplified vertex is a corner: the output is the simplified
   *  polygon (Smoothness 0). */
  readonly polygon?: boolean;
};

/** The fit tolerance at the neutral Optimize, in working px. */
export const DEFAULT_STROKE_FIT_TOLERANCE_PX = 0.25;

// The finished stroke as compact cubics (ADR-405). Douglas-Peucker still
// decides WHERE the corners are — its sparse vertices carry the turn evidence
// the corner test was tuned on — but the curve is fitted to the dense faired
// chain those vertices came from, within the fit tolerance. Corners stay
// exact C0 vertices; branch attachments stay exact G1 knots so a welded
// branch still ends on the through-stroke. The compatibility polyline is the
// curve's own sampling, registered so the curve reaches the scene.
export function strokeOutput(
  faired: ReadonlyArray<Vec2>,
  simplified: ReadonlyArray<Vec2>,
  closed: boolean,
  drawnCorners: ReadonlySet<Vec2>,
  attached: ReadonlySet<Vec2> | undefined,
  policy: StrokeCurvePolicy,
): Polyline | null {
  const corners =
    policy.polygon === true
      ? new Set(simplified)
      : collectOutputCorners(
          simplified,
          closed,
          drawnCorners,
          policy.cornerAngleRad,
          policy.drawnCornerMinRad,
        );
  const knots = attached ?? NO_KNOTS;
  const source = policy.polygon === true ? simplified : faired;
  const curve = fitStrokeCurve(
    source,
    closed,
    corners,
    knots,
    policy.fitTolerancePx ?? DEFAULT_STROKE_FIT_TOLERANCE_PX,
  );
  if (curve === null || curve.segments.length === 0) return null;
  const points = sampleStrokeCurve(curve);
  registerTraceCurve(points, curve);
  return { points, closed: curve.closed };
}

const NO_KNOTS: ReadonlySet<Vec2> = new Set();
