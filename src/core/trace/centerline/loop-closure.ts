// Loop closure for assembled chains. An open chain whose own two ends nearly
// meet is a broken ring: detection dropouts (Canny hysteresis, ambiguous
// junction gradients) open a drawn loop at whichever point the boundary walk
// happened to start. Three closure tiers:
//   * touch   — ends within the strict gap close outright (overlap dedupe).
//   * aligned — both end tangents CONTINUE across the closing chord (a ring
//     broken mid-curve); reach scales with the join knob.
//   * corner  — the ends meet at a drawn CORNER (letter outlines break at a
//     serif or apex, where the two tangents disagree by up to ~90°), so
//     tangent alignment can never pass; the gate is instead a short gap
//     relative to both the knob and the loop length, plus a no-hairpin
//     check so V-tips whose ends recede from each other stay open.

import type { Polyline, Vec2 } from '../../scene';
import { pointAtArcDistance } from './polyline-window';

export type LoopClosureOptions = {
  /** Ends closer than this always close, dropping the duplicate end point. */
  readonly touchGapPx: number;
  /** Reach for ends that meet at a corner (tangents disagree). */
  readonly cornerGapPx: number;
  /** Reach for tangent-aligned continuations across the closing chord. */
  readonly alignedGapPx: number;
};

export type LoopClosureDecision =
  | { readonly kind: 'open' }
  | { readonly kind: 'close'; readonly dropLastPoint: boolean };

/** Strict touch distance shared by every assembly stage. */
export const LOOP_TOUCH_GAP_PX = 1.5;

// Below this the ring is already geometrically closed (matches potrace's
// GEOMETRY_EPS convention for appending the start point).
const RING_RETURN_EPS = 1e-6;

/** Make every closed polyline explicitly return to its start point.
 *
 *  The corner/aligned closure tiers mark a ring `closed` while its endpoints
 *  remain up to a join gap apart — the closing edge (the drawn corner where
 *  the two ends meet) is left IMPLICIT. That is fine for fill rendering, but
 *  the canvas line-stroke renderer and the G-code toolpath emitter draw a
 *  closed polyline's points AS GIVEN and never synthesise the closing edge;
 *  they assume the convention potrace and text glyphs follow (last point
 *  coincides with the first). A ring that violates it renders and ENGRAVES a
 *  gap exactly the size of the endpoint separation. Append the start point so
 *  edge/centerline rings conform — a no-op for rings already closed to
 *  within epsilon. */
export function closeRingEndpoints(polylines: ReadonlyArray<Polyline>): Polyline[] {
  return polylines.map((polyline) => {
    if (!polyline.closed || polyline.points.length < 3) return polyline;
    const first = polyline.points[0];
    const last = polyline.points.at(-1);
    if (first === undefined || last === undefined) return polyline;
    if (Math.hypot(last.x - first.x, last.y - first.y) <= RING_RETURN_EPS) return polyline;
    return { closed: true, points: [...polyline.points, { x: first.x, y: first.y }] };
  });
}

const TANGENT_SPAN_PX = 3;
const MIN_ALIGNED_DOT = Math.cos((35 * Math.PI) / 180);
// An aligned closure must look like a broken ring, not a drawn C.
const MAX_ALIGNED_GAP_FRACTION = 0.25;
// A corner closure carries no tangent evidence, so it must be even more
// clearly a loop: the gap has to be small next to the loop itself.
const MAX_CORNER_GAP_FRACTION = 0.15;
// Ends whose outward tangents clearly RECEDE from each other are two stroke
// tips that merely end near each other (a drawn U) — never staple those.
const MIN_CORNER_FORWARDNESS_SUM = -0.25;
// Below this gap the tangent evidence is unreliable: the weld stage may have
// sideways-snapped the very endpoint, kinking the last segment the tangent
// is measured from. A loop-sized chain with a sub-3px gap closes on the
// gap/loop ratio alone.
const TANGENT_TRUST_GAP_PX = 3;
const MIN_LOOP_POINTS = 4;
const NEAR_ZERO = 1e-9;

/** Decide whether an open chain's two ends form an almost-closed loop. */
export function decideLoopClosure(
  points: ReadonlyArray<Vec2>,
  options: LoopClosureOptions,
): LoopClosureDecision {
  if (points.length < MIN_LOOP_POINTS) return { kind: 'open' };
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return { kind: 'open' };
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  if (gap <= options.touchGapPx) return { kind: 'close', dropLastPoint: true };
  if (gap > Math.max(options.cornerGapPx, options.alignedGapPx)) return { kind: 'open' };
  const arc = arcLengthOf(points);
  const forward = closureForwardness(points, first, last, gap);
  if (forward === null) return { kind: 'open' };
  const closes =
    isAlignedClosure(gap, arc, forward, options) || isCornerClosure(gap, arc, forward, options);
  return closes ? { kind: 'close', dropLastPoint: false } : { kind: 'open' };
}

function isAlignedClosure(
  gap: number,
  arc: number,
  forward: ClosureForwardness,
  options: LoopClosureOptions,
): boolean {
  return (
    gap <= options.alignedGapPx &&
    gap <= arc * MAX_ALIGNED_GAP_FRACTION &&
    forward.endForward >= MIN_ALIGNED_DOT &&
    forward.startForward >= MIN_ALIGNED_DOT
  );
}

function isCornerClosure(
  gap: number,
  arc: number,
  forward: ClosureForwardness,
  options: LoopClosureOptions,
): boolean {
  if (gap > options.cornerGapPx || gap > arc * MAX_CORNER_GAP_FRACTION) return false;
  if (gap <= Math.min(TANGENT_TRUST_GAP_PX, options.cornerGapPx)) return true;
  return forward.endForward + forward.startForward >= MIN_CORNER_FORWARDNESS_SUM;
}

/** Apply loop closure to finished polylines (post-reconnection sweep). */
export function closePolylineLoops(
  polylines: ReadonlyArray<Polyline>,
  options: LoopClosureOptions,
): Polyline[] {
  return polylines.map((polyline) => {
    if (polyline.closed) return polyline;
    const decision = decideLoopClosure(polyline.points, options);
    if (decision.kind === 'open') return polyline;
    return {
      points: decision.dropLastPoint ? polyline.points.slice(0, -1) : [...polyline.points],
      closed: true,
    };
  });
}

type ClosureForwardness = {
  readonly endForward: number;
  readonly startForward: number;
};

// How much each end travels TOWARD the other across the closing chord:
// the end's outward tangent (and the start's inward tangent) dotted with
// the chord from last to first.
function closureForwardness(
  points: ReadonlyArray<Vec2>,
  first: Vec2,
  last: Vec2,
  gap: number,
): ClosureForwardness | null {
  if (gap < NEAR_ZERO) return { endForward: 1, startForward: 1 };
  const chord = { x: (first.x - last.x) / gap, y: (first.y - last.y) / gap };
  const endTangentAnchor = pointAtArcDistance(points, false, TANGENT_SPAN_PX);
  const startTangentAnchor = pointAtArcDistance(points, true, TANGENT_SPAN_PX);
  if (endTangentAnchor === undefined || startTangentAnchor === undefined) return null;
  const outOfEnd = unit(last.x - endTangentAnchor.x, last.y - endTangentAnchor.y);
  const intoStart = unit(startTangentAnchor.x - first.x, startTangentAnchor.y - first.y);
  if (outOfEnd === null || intoStart === null) return null;
  return {
    endForward: outOfEnd.x * chord.x + outOfEnd.y * chord.y,
    startForward: intoStart.x * chord.x + intoStart.y * chord.y,
  };
}

function arcLengthOf(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

function unit(x: number, y: number): Vec2 | null {
  const len = Math.hypot(x, y);
  return len < NEAR_ZERO ? null : { x: x / len, y: y / len };
}
