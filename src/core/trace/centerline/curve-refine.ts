// Output curve refinement. Douglas-Peucker emits sparse polygonal vertices,
// and the app draws those chords literally — every curve renders as visible
// flat facets (the faceted-letters defect). The dense chain is already
// evened toward smooth curvature upstream (chain-smoothing.ts), so the
// refine step's only job is to REPLACE the chords with a smooth curve that
// passes through the vertices without kinking at them. A centripetal
// Catmull-Rom resample does exactly that (curve-fit.ts): moderate turns
// between vertices become smooth arcs, while genuine corners break the spline
// and are emitted exactly. Chaikin was rejected here — its chord-quartering
// leaves a facet at every pinned soft-turn vertex, so it cannot smooth an
// already-evened curve.

import type { Vec2 } from '../../scene';
import { fitSmoothCurve } from './curve-fit';

// Turns at least this sharp are corners: they break the smooth spline so their
// legs stay straight. Matches the hard-corner threshold used across the
// sharpener and the dense-chain evening, so a junction weld or loop-closure
// corner the sharpener never rebuilt is still treated as a corner here.
const HARD_CORNER_RAD = (60 * Math.PI) / 180;
// New samples placed inside each spline segment. Four keeps the drawn curve
// smooth at engraving scale while holding the total point count near the
// simplified-vertex budget (a smooth curve needs even curvature, not brute
// density).
const SAMPLES_PER_SEGMENT = 3;
const NEAR_POINT_EPS = 1e-9;
const NO_CORNERS: ReadonlySet<Vec2> = new Set();

/** Round a simplified chain for output. Drawn corners (marked by the bend
 *  sharpener, by reference), hard turns, and open-chain endpoints stay exact;
 *  smooth spans resample into an even-curvature Catmull-Rom curve. */
export function refineChainForOutput(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  drawnCorners: ReadonlySet<Vec2> = NO_CORNERS,
): Vec2[] {
  if (points.length < 3) return [...points];
  const corners = collectCorners(points, closed, drawnCorners);
  return fitSmoothCurve(points, closed, corners, SAMPLES_PER_SEGMENT);
}

// Corners that break the spline: the sharpener's rebuilt vertices plus any
// hard turn it never saw. Soft and moderate turns are deliberately NOT
// corners — the upstream evening already made them genuine curve, so letting
// the spline flow through them is what removes the facets.
function collectCorners(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  drawnCorners: ReadonlySet<Vec2>,
): ReadonlySet<Vec2> {
  const corners = new Set<Vec2>();
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    if (p === undefined) continue;
    if (drawnCorners.has(p) || turnAtIndex(points, i, closed) >= HARD_CORNER_RAD) corners.add(p);
  }
  return corners;
}

function turnAtIndex(points: ReadonlyArray<Vec2>, i: number, closed: boolean): number {
  const n = points.length;
  if (!closed && (i === 0 || i === n - 1)) return 0;
  const prev = points[(i - 1 + n) % n];
  const at = points[i];
  const next = points[(i + 1) % n];
  if (prev === undefined || at === undefined || next === undefined) return 0;
  return turnAt(prev, at, next);
}

function turnAt(prev: Vec2, at: Vec2, next: Vec2): number {
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLen < NEAR_POINT_EPS || outLen < NEAR_POINT_EPS) return 0;
  const dot =
    ((at.x - prev.x) / inLen) * ((next.x - at.x) / outLen) +
    ((at.y - prev.y) / inLen) * ((next.y - at.y) / outLen);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
