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
import { SegmentGrid } from './spatial-grid';

type WeldChain = { points: Vec2[]; closed: boolean; alive: boolean };

const MATCH_EPS = 1e-6;
// Loops that closed during pruning get FULLY smoothed (no pinned ends), so
// their junction point has drifted off the exact centroid — match the
// nearest chain point within this reach instead of exact equality.
const MATCH_REACH_PX = 2.5;
const MIN_SEAM_RADIUS_PX = 1.25;
// Seam stitching exists to FLATTEN A DENT: the window it removes must
// already hug the replacement chord. If the removed span wanders further
// than this from the chord, the "seam" is real geometry (a blob-interior
// squiggle from binarized shading) and stitching would slash a straight
// chord across the drawing. Scale-free: fat drawn strokes pass (their T
// dents are ~1-2 px), blobs of any radius fail.
const MAX_STITCH_SAG_PX = 1.75;
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
 *  the junction point, and the branch must keep touching them.
 *
 *  When `openEndWeldReachPx` is set (edge mode), EVERY open end that stops
 *  just short of another polyline welds onto it, provided its outward
 *  tangent points toward the landing spot — Canny drops pixels wherever
 *  edges meet (gradient direction is ambiguous at junctions), so edge maps
 *  are full of lines ending a hair before the line they visibly join. The
 *  tangent gate keeps parallel passers-by unwelded. */
export function weldBranchEnds(
  polylines: ReadonlyArray<WeldChain>,
  junctions: ReadonlyArray<Vec2>,
  openEndWeldReachPx = 0,
): void {
  // A shared segment grid replaces the per-end full scan of every chain's
  // every segment. Weld reach is tiny (≤ maxReach), so cells that size span
  // the query. Welds move endpoints, mutating adjacent segments, so the grid
  // is marked stale on each successful weld and rebuilt lazily before the
  // next query — most ends do not weld, so the grid usually stays valid.
  const maxReach = Math.max(WELD_REACH_PX, openEndWeldReachPx);
  const foots = new WeldFootFinder(polylines, maxReach);
  for (const chain of polylines) {
    if (!chain.alive || chain.closed || chain.points.length < 2) continue;
    weldChainEnd(chain, 'start', foots, junctions, openEndWeldReachPx);
    weldChainEnd(chain, 'end', foots, junctions, openEndWeldReachPx);
  }
}

function weldChainEnd(
  chain: WeldChain,
  which: 'start' | 'end',
  foots: WeldFootFinder,
  junctions: ReadonlyArray<Vec2>,
  openEndWeldReachPx: number,
): void {
  const end = which === 'start' ? chain.points[0] : chain.points.at(-1);
  if (end === undefined) return;
  const atJunction = isJunctionPoint(end, junctions);
  const reach = atJunction ? WELD_REACH_PX : openEndWeldReachPx;
  if (reach <= 0) return;
  const otherFoot = foots.nearestFootOnOthers(end, chain, reach);
  const selfFoot = nearestFootOnSelf(end, chain.points, which, reach);
  const foot = nearerFoot(end, otherFoot, selfFoot);
  if (foot === null) return;
  if (!atJunction && !endApproaches(chain.points, which, foot)) return;
  if (which === 'start') chain.points[0] = foot;
  else chain.points[chain.points.length - 1] = foot;
  foots.markDirty();
}

function nearerFoot(end: Vec2, a: Vec2 | null, b: Vec2 | null): Vec2 | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.hypot(a.x - end.x, a.y - end.y) <= Math.hypot(b.x - end.x, b.y - end.y) ? a : b;
}

// An open end that stops just short of its OWN chain welds onto it (a
// letter outline whose walk ends alongside an earlier stretch — P/R bowls).
// The segments adjacent to the end are excluded by arc distance, otherwise
// every end would trivially "weld" to its own neighbouring segment.
const SELF_WELD_EXCLUSION_ARC_FACTOR = 3;
const MIN_SELF_WELD_EXCLUSION_ARC_PX = 6;

function nearestFootOnSelf(
  end: Vec2,
  points: ReadonlyArray<Vec2>,
  which: 'start' | 'end',
  reachPx: number,
): Vec2 | null {
  const exclusionArc = Math.max(
    MIN_SELF_WELD_EXCLUSION_ARC_PX,
    reachPx * SELF_WELD_EXCLUSION_ARC_FACTOR,
  );
  const ordered = which === 'end' ? [...points].reverse() : points;
  let best: Vec2 | null = null;
  let bestDist = reachPx;
  let cumulativeArc = 0;
  for (let i = 0; i + 1 < ordered.length; i += 1) {
    const a = ordered[i];
    const b = ordered[i + 1];
    if (a === undefined || b === undefined) continue;
    cumulativeArc += Math.hypot(b.x - a.x, b.y - a.y);
    if (cumulativeArc <= exclusionArc) continue;
    const foot = projectOntoSegment(end, a, b);
    const d = Math.hypot(foot.x - end.x, foot.y - end.y);
    if (d < bestDist) {
      bestDist = d;
      best = foot;
    }
  }
  return best;
}

// The end's outward continuation must point toward the weld target — a line
// merely passing parallel to another must not sideways-snap onto it.
const MIN_WELD_APPROACH_DOT = 0.2;

function endApproaches(pts: ReadonlyArray<Vec2>, which: 'start' | 'end', foot: Vec2): boolean {
  const end = which === 'start' ? pts[0] : pts.at(-1);
  const inner = which === 'start' ? pts[1] : pts.at(-2);
  if (end === undefined || inner === undefined) return false;
  const outLen = Math.hypot(end.x - inner.x, end.y - inner.y);
  const toFootLen = Math.hypot(foot.x - end.x, foot.y - end.y);
  if (outLen < MATCH_EPS || toFootLen < MATCH_EPS) return true;
  const dot =
    ((end.x - inner.x) / outLen) * ((foot.x - end.x) / toFootLen) +
    ((end.y - inner.y) / outLen) * ((foot.y - end.y) / toFootLen);
  return dot >= MIN_WELD_APPROACH_DOT;
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
  if (!removedSpanHugsChord(pts, head.length - 1, pts.length - tail.length, headEnd, tailStart)) {
    return [...pts]; // real geometry, not a dent — never fabricate a shortcut
  }
  const seat = projectOntoSegment(junction, headEnd, tailStart);
  return [...head, seat, ...tail];
}

function removedSpanHugsChord(
  pts: ReadonlyArray<Vec2>,
  from: number,
  to: number,
  chordA: Vec2,
  chordB: Vec2,
): boolean {
  for (let k = Math.max(0, from); k <= Math.min(pts.length - 1, to); k += 1) {
    const p = pts[k];
    if (p === undefined) continue;
    const d = distanceToSegment(p, chordA, chordB);
    if (d > MAX_STITCH_SAG_PX) return false;
  }
  return true;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const foot = projectOntoSegment(p, a, b);
  return Math.hypot(p.x - foot.x, p.y - foot.y);
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

// Grid-accelerated nearest-foot search over OTHER chains' segments. Replaces
// the O(ends × all segments) full scan: only segments in cells near the query
// end are tested. Selection is IDENTICAL to the scan — candidates are ordered
// by (chain index, segment index) and the first foot achieving the strict
// minimum wins, exactly as the array-order scan did.
class WeldFootFinder {
  private readonly polylines: ReadonlyArray<WeldChain>;
  private readonly cellSize: number;
  private grid: SegmentGrid;
  private dirty = false;

  constructor(polylines: ReadonlyArray<WeldChain>, maxReach: number) {
    this.polylines = polylines;
    this.cellSize = maxReach;
    this.grid = this.build();
  }

  markDirty(): void {
    this.dirty = true;
  }

  nearestFootOnOthers(end: Vec2, own: WeldChain, reachPx: number): Vec2 | null {
    if (this.dirty) {
      this.grid = this.build();
      this.dirty = false;
    }
    const ownIndex = this.polylines.indexOf(own);
    // Dedup segments that span multiple cells, then order by (chain, segment)
    // so tie-breaking matches the original array-order scan exactly.
    const seen = new Set<string>();
    const candidates: Array<{ ci: number; si: number; a: Vec2; b: Vec2 }> = [];
    for (const seg of this.grid.query(end, reachPx)) {
      if (seg.ownerId === ownIndex) continue;
      const key = `${seg.ownerId}:${seg.segIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ ci: seg.ownerId, si: seg.segIndex, a: seg.a, b: seg.b });
    }
    candidates.sort((x, y) => (x.ci !== y.ci ? x.ci - y.ci : x.si - y.si));
    let best: Vec2 | null = null;
    let bestDist = reachPx;
    for (const c of candidates) {
      const foot = projectOntoSegment(end, c.a, c.b);
      const d = Math.hypot(foot.x - end.x, foot.y - end.y);
      if (d < bestDist) {
        bestDist = d;
        best = foot;
      }
    }
    return best;
  }

  private build(): SegmentGrid {
    const grid = new SegmentGrid(this.cellSize);
    for (let ci = 0; ci < this.polylines.length; ci += 1) {
      const other = this.polylines[ci];
      if (other === undefined || !other.alive || other.points.length < 2) continue;
      const count = other.points.length + (other.closed ? 0 : -1);
      for (let i = 0; i < count; i += 1) {
        const a = other.points[i];
        const b = other.points[(i + 1) % other.points.length];
        if (a === undefined || b === undefined) continue;
        grid.insert({ ownerId: ci, segIndex: i, a, b });
      }
    }
    return grid;
  }
}
