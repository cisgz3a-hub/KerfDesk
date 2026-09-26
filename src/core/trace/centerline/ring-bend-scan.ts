// The closed-ring half of corner restoration (sharpen-bends.ts owns the
// gates). A ring has no ends, so each candidate is judged with the ring
// centred on it, and every rebuilt corner re-centres the ring on itself and
// rescans from the top until a scan changes nothing. The settled result
// depends on that order: a rebuilt corner can straighten a neighbour's legs
// and let it rebuild too, so a different visiting order settles on a
// different (equally plausible) corner set. The order is therefore kept, and
// made cheap instead:
//  * every gate reads a bounded arc around its candidate, so a candidate is
//    judged on just that stretch of ring, never on a copy of the whole ring;
//  * a rejection is remembered per vertex and only forgotten when a rebuilt
//    corner lands inside the stretch it read, so the rescans after a rebuild
//    re-judge that neighbourhood and skip everything else;
//  * the ring is stored once and rotated by an offset: re-centring moves the
//    offset and a rebuilt corner is spliced into place, instead of copying and
//    re-measuring the whole ring per corner.

import type { Vec2 } from '../../scene';
import type { TraceSteps } from '../trace-steps';
import { edgeLength } from './bend-geometry';

/** A bend replaces ring positions [from, to) with its corner vertex. The
 *  positions may run below 0 or past n and wrap. */
export type RingBend = {
  readonly from: number;
  readonly to: number;
  readonly corner: Vec2;
};

export type RingBendJudge = {
  /** The cheap turn gate a vertex must pass before any attempt. */
  readonly admits: (pts: ReadonlyArray<Vec2>, i: number) => boolean;
  /** The farthest arc length any gate reads around vertex i. */
  readonly reachPx: (pts: ReadonlyArray<Vec2>, i: number) => number;
  /** Take one attempt from the trace's allowance; false once it is spent. */
  readonly spend: () => boolean;
  /** The widest arm any gate may use; a larger ring arm cap never binds. */
  readonly maxGateArmPx: number;
  /** Judge vertex `at` of an open stretch, whose edge k (from point k to
   *  k + 1) is seg[k] long; positions are the stretch's. */
  readonly attempt: (
    stretch: ReadonlyArray<Vec2>,
    seg: Float64Array,
    at: number,
    maxArm: number,
  ) => RingBend | null;
  /** Final say on a bend in ring positions (corner spacing, anchors). */
  readonly accept: (pts: ReadonlyArray<Vec2>, bend: RingBend) => boolean;
};

// A closed chain's window may not swallow the whole loop: cap the arm so two
// corners of a tiny feature can't trim each other away.
const CLOSED_ARM_LENGTH_DIVISOR = 6;
// Iteration budget: a base allowance plus one chain-length per replacement
// (each replacement re-centres the ring and restarts the scan). The base
// absorbs the no-replacement scan.
const GUARD_BASE_BUDGET = 64;
// Points kept past the farthest gate read: every walk may overshoot its arc
// by one step, and a tangent chord starts from an overshot point.
const NEIGHBOURHOOD_MARGIN_POINTS = 6;
// Relative slack on arc comparisons made against a different ring version.
const ARC_SLACK = 1e-9;

type RingStretch = {
  readonly view: ReadonlyArray<Vec2>;
  readonly seg: Float64Array;
  readonly at: number;
  /** The stretch reaches the ring's half on a side, so the ring's length
   *  (not only its nearby points) shapes what the gates see. */
  readonly capped: boolean;
  /** Points the stretch holds on its longer side. */
  readonly extent: number;
};

/** Sharpen a ring; returns the settled ring (re-centred on its last rebuilt
 *  corner, or the input order when nothing was rebuilt). */
export function* sharpenRingSteps(
  points: ReadonlyArray<Vec2>,
  judge: RingBendJudge,
  replacements: number,
): TraceSteps<Vec2[]> {
  const cooperate = yield;
  const scan = new RingScan(points, judge);
  let replacementsLeft = replacements;
  let guard = scan.pts.length * 2 + GUARD_BASE_BUDGET;
  let i = 1;
  while (guard > 0 && i < scan.pts.length) {
    if (cooperate) yield;
    guard -= 1;
    const outcome = scan.visit(i);
    if (outcome === 'stop') break;
    if (outcome === 'next') {
      i += 1;
      continue;
    }
    replacementsLeft -= 1;
    if (replacementsLeft <= 0) break;
    guard += scan.pts.length;
    scan.forgetAroundLastCorner();
    i = 1;
  }
  return scan.ring();
}

// The ring as it is rebuilt: stored once, read from `start` (the ring the
// visiting order sees is pts rotated left by `start`), with the rejections it
// remembers. Visits take positions in that rotated order; everything else
// works on stored positions, which the gates cannot tell apart on a ring.
class RingScan {
  pts: Vec2[];
  // seg[k]: length of the stored edge from pts[k] to the next point (the
  // last one closes the ring). Spliced along with the ring.
  private seg: Float64Array;
  // Cumulative stored arc: arcs.at[k] = seg[0] + … + seg[k - 1]. A splice
  // leaves the sums before it valid, so only the rest is re-added.
  private arcs: RingArcs = { at: new Float64Array(1), n: 0 };
  private arcsValidTo = 0;
  private start = 0;
  // Remembered rejections are keyed by vertex object; a ring that carries one
  // object twice judges each position afresh.
  private readonly settled: Set<Vec2> | null;
  private maxArm: number | undefined;
  private ringReach: number | undefined;
  // The longest side of any remembered stretch (see visit).
  private settledExtent = 0;
  private lastVertex = 0;

  constructor(
    points: ReadonlyArray<Vec2>,
    private readonly judge: RingBendJudge,
  ) {
    this.pts = [...points];
    this.seg = Float64Array.from(this.pts, (_, k) => ringEdge(this.pts, k));
    this.settled = new Set(this.pts).size === this.pts.length ? new Set<Vec2>() : null;
  }

  /** The ring in visiting order. */
  ring(): Vec2[] {
    return this.start === 0
      ? this.pts
      : [...this.pts.slice(this.start), ...this.pts.slice(0, this.start)];
  }

  /** Judge the vertex at visiting position `position`: move on, stop
   *  (budget spent), or a rebuilt corner. */
  visit(position: number): 'next' | 'stop' | 'rebuilt' {
    const { pts, judge, settled } = this;
    const n = pts.length;
    const i = (this.start + position) % n;
    const p = pts[i] as Vec2;
    const maxArm = (this.maxArm ??= this.armCap());
    const remember = settled !== null && maxArm >= judge.maxGateArmPx;
    if (remember && settled.has(p)) return 'next';
    if (!judge.admits(pts, i)) return 'next';
    if (!judge.spend()) return 'stop';
    const stretch = ringStretchAt(pts, this.seg, this.ringArcs(), i, judge.reachPx(pts, i));
    const bend = attemptOn(stretch, i, judge, maxArm);
    if (bend === null || !judge.accept(pts, bend)) {
      if (remember && !stretch.capped) {
        settled.add(p);
        this.settledExtent = Math.max(this.settledExtent, stretch.extent);
      }
      return 'next';
    }
    this.rebuild(i, bend);
    return 'rebuilt';
  }

  forgetAroundLastCorner(): void {
    if (this.settled === null) return;
    const { judge, pts } = this;
    this.ringReach ??= widestReach(pts, judge);
    forgetAround(this.settled, pts, this.seg, this.lastVertex, this.ringReach, (k) =>
      judge.reachPx(pts, k),
    );
  }

  // The ring re-centred on stored position i (at visiting position ⌊n/2⌋)
  // with the bend's window replaced by its corner.
  private rebuild(i: number, bend: RingBend): void {
    const { pts, judge, settled } = this;
    const n = pts.length;
    const mid = Math.floor(n / 2);
    // Visiting order starts at stored position i - mid, unless the window
    // begins there; then it starts at the corner.
    const first = wrap(i - mid, n);
    const startsAtCorner = bend.from - (i - mid) === 0;
    const from = wrap(bend.from, n);
    const corner = spliceRing(pts, this.seg, from, bend.to - bend.from, bend.corner);
    this.seg = corner.seg;
    // Sums up to the corner's incoming edge survive a splice that moved
    // nothing before it; one that wrapped moved every position.
    const kept = corner.shift(0) === 0 ? corner.at - 1 : 0;
    this.arcsValidTo = Math.max(0, Math.min(this.arcsValidTo, kept));
    const removedBefore = (q: number): number => corner.shift(q);
    this.start = startsAtCorner ? corner.at : first - removedBefore(first);
    this.lastVertex = corner.at;
    this.maxArm = undefined;
    // Each rebuild shortens the ring. A remembered stretch that the shorter
    // ring's half no longer holds would now be cut at the half (the gates
    // could see a different end), so its verdict no longer stands; far from
    // the corner the forgetting walk would miss it, so all are dropped.
    const half = Math.floor(pts.length / 2);
    if (settled !== null && this.settledExtent >= Math.min(half, pts.length - half - 1)) {
      settled.clear();
      this.settledExtent = 0;
    }
    // A rebuilt corner is a new vertex; its own reach may be the widest.
    if (this.ringReach !== undefined) {
      this.ringReach = Math.max(this.ringReach, judge.reachPx(pts, corner.at));
    }
  }

  private ringArcs(): RingArcs {
    const { seg } = this;
    const n = seg.length;
    let at = this.arcs.at;
    if (at.length !== n + 1) {
      const grown = new Float64Array(n + 1);
      grown.set(at.subarray(0, Math.min(at.length, this.arcsValidTo + 1)));
      at = grown;
    }
    for (let k = this.arcsValidTo; k < n; k += 1)
      at[k + 1] = (at[k] as number) + (seg[k] as number);
    this.arcs = { at, n };
    this.arcsValidTo = n;
    return this.arcs;
  }

  // The arm cap: the ring's open length in visiting order (every edge but
  // the one closing it) over the divisor. Its exact value only matters when
  // it is below the widest gate arm; above, it never binds and any value
  // that stays above serves.
  private armCap(): number {
    const { seg, start } = this;
    const n = seg.length;
    const total = this.ringArcs().at[n] as number;
    const open = total - (seg[wrap(start - 1, n)] as number);
    if (open * (1 - ARC_SLACK) > this.judge.maxGateArmPx * CLOSED_ARM_LENGTH_DIVISOR) {
      return open / CLOSED_ARM_LENGTH_DIVISOR;
    }
    // The exact ordered sum arcLengthOf takes over the rotated ring.
    let exact = 0;
    for (let k = 0; k < n - 1; k += 1) exact += seg[wrap(start + k, n)] as number;
    return exact / CLOSED_ARM_LENGTH_DIVISOR;
  }
}

// Replace `count` ring positions from stored position `from` (wrapping past
// the end) with `corner`, in place. Returns the corner's stored position and
// how far a kept position q moved down.
function spliceRing(
  pts: Vec2[],
  stored: Float64Array,
  from: number,
  count: number,
  corner: Vec2,
): {
  readonly at: number;
  readonly shift: (q: number) => number;
  readonly seg: Float64Array;
} {
  const n = pts.length;
  let at = from;
  let shift: (q: number) => number;
  let seg: Float64Array;
  if (from + count <= n) {
    pts.splice(from, count, corner);
    stored.copyWithin(from + 1, from + count);
    seg = stored.subarray(0, n - count + 1);
    shift = (q) => (q < from ? 0 : count - 1);
  } else {
    const tail = n - from;
    const head = count - tail;
    pts.splice(from, tail, corner);
    pts.splice(0, head);
    stored.copyWithin(0, head, from + 1);
    seg = stored.subarray(0, from + 1 - head);
    at = from - head;
    shift = () => head;
  }
  // Only the corner's two edges are new.
  const size = pts.length;
  seg[at] = ringEdge(pts, at);
  seg[wrap(at - 1, size)] = ringEdge(pts, wrap(at - 1, size));
  return { at, shift, seg };
}

// The stretch is the candidate with the ring around it — at most half the
// ring each side, the context the ring centred on it offers — cut a few
// points past the farthest gate read, so the gates return exactly what they
// would on the whole centred ring. Where the stored ring holds the candidate
// that deep, it is read in place with no copy.
function ringStretchAt(
  pts: ReadonlyArray<Vec2>,
  seg: Float64Array,
  arcs: RingArcs,
  i: number,
  reach: number,
): RingStretch {
  const n = pts.length;
  const mid = Math.floor(n / 2);
  const before = sideExtent(arcs, i, -1, reach, mid);
  const after = sideExtent(arcs, i, 1, reach, n - mid - 1);
  const capped = before >= mid || after >= n - mid - 1;
  const extent = Math.max(before, after);
  if (!capped && i - before >= 0 && i + after < n) {
    return { view: pts, seg, at: i, capped, extent };
  }
  const count = before + after + 1;
  const view = copyStretch(pts, i - before, count);
  // The copy's edges are the stored edges it spans, minus the one leaving it.
  const copied = new Float64Array(Math.max(0, count - 1));
  for (let k = 0; k + 1 < count; k += 1) copied[k] = seg[wrap(i - before + k, n)] as number;
  return { view, seg: copied, at: before, capped, extent };
}

function attemptOn(
  stretch: RingStretch,
  i: number,
  judge: RingBendJudge,
  maxArm: number,
): RingBend | null {
  const bend = judge.attempt(stretch.view, stretch.seg, stretch.at, maxArm);
  if (bend === null) return null;
  const shift = i - stretch.at;
  return { from: bend.from + shift, to: bend.to + shift, corner: bend.corner };
}

// The stored edge from pts[k] to the next point, closing edge included.
function ringEdge(pts: ReadonlyArray<Vec2>, k: number): number {
  return edgeLength(pts, k, k + 1 === pts.length ? 0 : k + 1);
}

// Cumulative stored arc: at[k] is the length from pts[0] to pts[k] along
// the ring, and at[n] the whole ring including its closing edge.
type RingArcs = { readonly at: Float64Array; readonly n: number };

// Arc covered by `steps` edges from stored position i, forward (dir 1) or back.
function arcSpan(arcs: RingArcs, i: number, steps: number, dir: -1 | 1): number {
  const { at, n } = arcs;
  const total = at[n] as number;
  if (dir === 1) {
    const end = i + steps;
    return end <= n
      ? (at[end] as number) - (at[i] as number)
      : total - (at[i] as number) + (at[end - n] as number);
  }
  const start = i - steps;
  return start >= 0
    ? (at[i] as number) - (at[start] as number)
    : (at[i] as number) + total - (at[n + start] as number);
}

// Points on one side: the first step count whose arc passes `reach`, plus
// the overshoot margin, capped at `cap` (the ring's half on that side).
function sideExtent(arcs: RingArcs, i: number, dir: -1 | 1, reach: number, cap: number): number {
  let low = 1;
  let high = cap;
  if (cap < 1) return Math.max(0, cap);
  if (arcSpan(arcs, i, cap, dir) <= reach) return cap;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (arcSpan(arcs, i, middle, dir) > reach) high = middle;
    else low = middle + 1;
  }
  return Math.min(cap, low + NEIGHBOURHOOD_MARGIN_POINTS);
}

function copyStretch(pts: ReadonlyArray<Vec2>, start: number, count: number): Vec2[] {
  const n = pts.length;
  const stretch = new Array<Vec2>(count);
  for (let k = 0; k < count; k += 1) stretch[k] = pts[wrap(start + k, n)] as Vec2;
  return stretch;
}

// The widest arc any vertex of this ring can read. The radius field is
// fixed, so one sweep per ring bounds every later forgetting walk.
function widestReach(pts: ReadonlyArray<Vec2>, judge: RingBendJudge): number {
  let widest = 0;
  for (let i = 0; i < pts.length; i += 1) widest = Math.max(widest, judge.reachPx(pts, i));
  return widest;
}

// Forget the rejection of every vertex whose stretch could have held a point
// the bend removed, or can now hold its corner. Walking away from the corner
// from each kept window edge, the vertex s steps out held the removed points
// when its stretch reached s + 1 steps back toward the corner: its first
// (s - margin) steps that way — edges the bend left unchanged — lie within its
// own reach. That is exactly how ringStretchAt sized it, measured from the
// vertex, so the test mirrors it rather than measuring from the corner. A
// relative slack absorbs the rounding of arcs summed in a different order; it
// can only forget more. No vertex reaches past the ring's widest reach,
// which ends the walk.
function forgetAround(
  settled: Set<Vec2>,
  pts: ReadonlyArray<Vec2>,
  seg: Float64Array,
  vertex: number,
  widest: number,
  reachOf: (k: number) => number,
): void {
  const n = pts.length;
  const loose = (reach: number): number => reach * (1 + ARC_SLACK) + ARC_SLACK;
  const walkEnd = loose(widest);
  for (const dir of [-1, 1] as const) {
    const edge = vertex + dir;
    // Arc of the edges from s - margin steps out back to `margin` steps out.
    let inner = 0;
    for (let s = 0; s < n - 1; s += 1) {
      const k = wrap(edge + s * dir, n);
      if (s > NEIGHBOURHOOD_MARGIN_POINTS) {
        // The edge between k and its neighbour toward the corner.
        inner += seg[dir === 1 ? wrap(k - 1, n) : k] as number;
        if (inner > walkEnd) break;
        if (inner > loose(reachOf(k))) continue;
      }
      settled.delete(pts[k] as Vec2);
    }
  }
}

function wrap(k: number, n: number): number {
  return ((k % n) + n) % n;
}
