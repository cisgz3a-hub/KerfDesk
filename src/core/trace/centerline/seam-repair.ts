// Junction-seam repair. The medial axis genuinely bends toward every T
// branch — where a branch meets a through-stroke the union is locally wider,
// so the ridge (and the junction cluster centroid the chains pass through)
// rises off the through-stroke's own centerline, denting it. The drawn
// stroke underneath is straight, so rebuild it: trim the seam window (one
// junction radius each side of the junction point) and stitch across with
// the junction point PROJECTED onto the chord. Chains that END at the
// junction (the branch itself) keep their endpoint — and after the
// through-path is straightened, `weldBranchEnds` snaps those endpoints onto
// the repaired line so branches still touch what they branch from.

import type { Vec2 } from '../../scene';
import { projectOntoSegment, radiusAtPosition, trimArc } from './polyline-window';

const MATCH_EPS = 1e-6;
// Loops that closed during pruning get FULLY smoothed (no pinned ends), so
// their junction point has drifted off the exact centroid — match the
// nearest chain point within this reach instead of exact equality.
const MATCH_REACH_PX = 2.5;
const MIN_SEAM_RADIUS_PX = 2;
const WELD_REACH_PX = 4;
// Stitch only seams the stroke passes STRAIGHT through (a T or X). A harder
// turn is a drawn bend — a fork elbow or corner — that belongs to the path
// (sharpen-bends rebuilds the hard ones). Tangents are measured over a few
// px of arc; single-segment tangents on raw pixels are ±15° noisy and made
// fork elbows stitch flat.
const MAX_STITCH_TURN_RAD = (25 * Math.PI) / 180;
const SEAM_TANGENT_SPAN_PX = 3;

/** Rebuild the seam window around every junction point a chain passes
 *  THROUGH. Returns a new point list. */
export function repairJunctionSeams(
  points: ReadonlyArray<Vec2>,
  closed: boolean,
  junctions: ReadonlyArray<Vec2>,
  distSq: Float64Array,
  width: number,
): Vec2[] {
  let pts = [...points];
  if (junctions.length === 0 || pts.length < 4) return pts;
  for (const junction of junctions) {
    const idx = indexOfPoint(pts, junction);
    if (idx < 0) continue;
    if (!closed && (idx === 0 || idx === pts.length - 1)) continue; // branch arm end
    const radius = Math.max(MIN_SEAM_RADIUS_PX, radiusAtPosition(junction, distSq, width));
    pts = closed ? stitchClosed(pts, idx, radius) : stitchOpen(pts, idx, radius);
  }
  return pts;
}

/** Snap every open-chain endpoint that sits ON a junction onto the nearest
 *  other polyline within reach — through-paths were straightened away from
 *  the junction point, and the branch must keep touching them. */
export function weldBranchEnds(
  polylines: ReadonlyArray<{ points: Vec2[]; closed: boolean; alive: boolean }>,
  junctions: ReadonlyArray<Vec2>,
): void {
  for (const chain of polylines) {
    if (!chain.alive || chain.closed || chain.points.length < 2) continue;
    for (const which of ['start', 'end'] as const) {
      const end = which === 'start' ? chain.points[0] : chain.points.at(-1);
      if (end === undefined || !isJunctionPoint(end, junctions)) continue;
      const foot = nearestFootOnOthers(end, chain, polylines);
      if (foot === null) continue;
      if (which === 'start') chain.points[0] = foot;
      else chain.points[chain.points.length - 1] = foot;
    }
  }
}

function isJunctionPoint(p: Vec2, junctions: ReadonlyArray<Vec2>): boolean {
  return junctions.some((j) => Math.abs(j.x - p.x) < MATCH_EPS && Math.abs(j.y - p.y) < MATCH_EPS);
}

function indexOfPoint(pts: ReadonlyArray<Vec2>, target: Vec2): number {
  let best = -1;
  let bestDist = MATCH_REACH_PX;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    if (p === undefined) continue;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function stitchOpen(pts: ReadonlyArray<Vec2>, idx: number, radius: number): Vec2[] {
  const junction = pts[idx];
  const head = trimArc(pts.slice(0, idx + 1), 'tail', radius);
  const tail = trimArc(pts.slice(idx), 'head', radius);
  const headEnd = head.at(-1);
  const tailStart = tail[0];
  if (junction === undefined || headEnd === undefined || tailStart === undefined) return [...pts];
  if (head.length < 2 || tail.length < 2) return [...pts]; // junction too near an end
  if (seamTurn(head, tail) > MAX_STITCH_TURN_RAD) return [...pts]; // drawn corner
  const seat = projectOntoSegment(junction, headEnd, tailStart);
  return [...head, seat, ...tail];
}

// Turn between the head's exit tangent and the tail's entry tangent, each
// measured over SEAM_TANGENT_SPAN_PX of arc.
function seamTurn(head: ReadonlyArray<Vec2>, tail: ReadonlyArray<Vec2>): number {
  const a1 = pointAtArcFromEnd(head, SEAM_TANGENT_SPAN_PX);
  const a2 = head.at(-1);
  const b1 = tail[0];
  const b2 = pointAtArcFromStart(tail, SEAM_TANGENT_SPAN_PX);
  if (!a1 || !a2 || !b1 || !b2) return Math.PI;
  const la = Math.hypot(a2.x - a1.x, a2.y - a1.y);
  const lb = Math.hypot(b2.x - b1.x, b2.y - b1.y);
  if (la < MATCH_EPS || lb < MATCH_EPS) return Math.PI;
  const dot =
    ((a2.x - a1.x) / la) * ((b2.x - b1.x) / lb) + ((a2.y - a1.y) / la) * ((b2.y - b1.y) / lb);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

function pointAtArcFromStart(pts: ReadonlyArray<Vec2>, arc: number): Vec2 | undefined {
  let cum = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined) break;
    cum += Math.hypot(b.x - a.x, b.y - a.y);
    if (cum >= arc) return b;
  }
  return pts.at(-1);
}

function pointAtArcFromEnd(pts: ReadonlyArray<Vec2>, arc: number): Vec2 | undefined {
  let cum = 0;
  for (let i = pts.length - 1; i > 0; i -= 1) {
    const a = pts[i];
    const b = pts[i - 1];
    if (a === undefined || b === undefined) break;
    cum += Math.hypot(a.x - b.x, a.y - b.y);
    if (cum >= arc) return b;
  }
  return pts[0];
}

// Rotate so the junction sits mid-array, then stitch there. A closed
// polyline is rotation-invariant, so the rotated result is returned as-is.
function stitchClosed(pts: ReadonlyArray<Vec2>, idx: number, radius: number): Vec2[] {
  const mid = Math.floor(pts.length / 2);
  const shift = (idx - mid + pts.length) % pts.length;
  const rotated = [...pts.slice(shift), ...pts.slice(0, shift)];
  return stitchOpen(rotated, mid, radius);
}

function nearestFootOnOthers(
  end: Vec2,
  own: { points: Vec2[] },
  polylines: ReadonlyArray<{ points: Vec2[]; closed: boolean; alive: boolean }>,
): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = WELD_REACH_PX;
  for (const other of polylines) {
    if (!other.alive || other === own || other.points.length < 2) continue;
    const count = other.points.length + (other.closed ? 0 : -1);
    for (let i = 0; i < count; i += 1) {
      const a = other.points[i];
      const b = other.points[(i + 1) % other.points.length];
      if (a === undefined || b === undefined) continue;
      const foot = projectOntoSegment(end, a, b);
      const d = Math.hypot(foot.x - end.x, foot.y - end.y);
      if (d < bestDist) {
        bestDist = d;
        best = foot;
      }
    }
  }
  return best;
}
