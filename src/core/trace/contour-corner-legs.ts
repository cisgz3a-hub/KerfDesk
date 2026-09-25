// Leg evidence for the corner dial (ADR-404): two straight legs meeting at a
// turn, their intersection as the apex, and the rounding cost of that corner.

import type { Vec2 } from '../scene';
import { latticeBarriers } from './contour-corner-lattice';
import {
  KEPT_FEATURE,
  LEG_CAP_PX,
  MIN_LEG_POINTS,
  MIN_LEG_TURN_RAD,
  POINTS_PER_PX,
  type Candidate,
  type CornerDialInput,
} from './contour-corner-types';

// Leg straightness: the largest perpendicular residual a leg may carry. Binary
// cracks of a digital straight line scatter up to ~±0.25 px about their line,
// and a thresholded edge adds its own wobble; measured (sub-pixel) cracks
// carry ~0.1 px noise.
const LEG_TOLERANCE_BINARY_PX = 0.5;
const LEG_TOLERANCE_MEASURED_PX = 0.2;
// ...plus this fraction of the leg's length: a leg is straight while its
// direction stays defined to ~2°, so threshold wobble on a long stem does not
// cut it short, while a circle's chords of that straightness are only ~0.24 R
// long and meet at under the 15° minimum turn.
export const LEG_SLOPE_TOLERANCE = 0.03;

export type LegTolerance = { readonly base: number; readonly slope: number };
const MIN_LEG_PX = 1;
// A leg corner may skip a few cracks of apex rounding (anti-aliasing,
// supersampling) that fit neither leg.
const MAX_SKIP_PX = 2;
// The apex may stand off the crack chain by the chamfer the pixels cut, which
// grows as the interior angle closes.
const APEX_STANDOFF_BASE_PX = 0.9;
const APEX_STANDOFF_ACUTE_PX = 0.5;
// A measured chain is the field's own iso-line, rounded only by the source's
// anti-aliasing: its hidden apex lies much closer (measured on owl and
// hummingbird: the binary allowance let corners cut into neighbouring
// outlines, 3900 topology conflicts vs 350 on the owl at Sharp).
const APEX_STANDOFF_MEASURED_BASE_PX = 0.3;
const APEX_STANDOFF_MEASURED_ACUTE_PX = 0.15;
// Weight of the one-circle model's excess RMS residual over the two-leg
// model's in the cost cap (see header).
const ARC_EXCESS_WEIGHT = 10;
export type Leg = {
  readonly count: number;
  // Fitted line: centroid and unit direction ALONG travel.
  readonly cx: number;
  readonly cy: number;
  readonly dx: number;
  readonly dy: number;
  /** Sum of squared perpendicular residuals about the line. */
  readonly residualSq: number;
};

// Leg growth also stops where the chain turns hard over a few pixels: the
// length-proportional tolerance would otherwise let a leg's far end wrap a
// few cracks round the NEXT corner (a chamfered or anti-aliased corner has no
// lattice barrier), tilting its fit. Marks a vertex stop at every peak of the
// chord turn over ±TURN_WINDOW_PX above TURN_STOP_RAD; a leg ignores the
// stops of its own corner (within its first cracks).
const TURN_WINDOW_PX = 3;
const TURN_STOP_RAD = Math.PI / 3;

function turnStops(pts: ReadonlyArray<Vec2>, scale: number): Uint8Array {
  const n = pts.length;
  const stops = new Uint8Array(n);
  const k = Math.max(2, Math.round(TURN_WINDOW_PX * scale));
  if (n < 2 * k + 1) return stops;
  const turns = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - k + n) % n] as Vec2;
    const at = pts[i] as Vec2;
    const next = pts[(i + k) % n] as Vec2;
    const inX = at.x - prev.x;
    const inY = at.y - prev.y;
    const outX = next.x - at.x;
    const outY = next.y - at.y;
    turns[i] = Math.abs(Math.atan2(inX * outY - inY * outX, inX * outX + inY * outY));
  }
  // One stop per turn peak, at the vertex on the side where the turn is
  // sharper: legs end where the chain turns, not a crack short of it.
  for (let i = 0; i < n; i += 1) {
    const turn = turns[i] as number;
    const before = turns[(i - 1 + n) % n] as number;
    const after = turns[(i + 1) % n] as number;
    if (turn <= TURN_STOP_RAD || turn < before || turn < after) continue;
    stops[after >= before ? (i + 1) % n : i] = 1;
  }
  return stops;
}

export function legCandidates(
  input: CornerDialInput,
  scale: number,
  lattice: ReadonlyArray<Candidate>,
): Candidate[] {
  const pts = input.cracks;
  const n = pts.length;
  const maxSkip = Math.ceil(MAX_SKIP_PX * scale);
  const capPoints = Math.min(
    Math.ceil(LEG_CAP_PX * scale * POINTS_PER_PX),
    Math.floor((n - maxSkip) / 2) - 1,
  );
  if (capPoints < MIN_LEG_POINTS) return [];
  const tolerance: LegTolerance = {
    base: input.measured ? LEG_TOLERANCE_MEASURED_PX : LEG_TOLERANCE_BINARY_PX,
    slope: LEG_SLOPE_TOLERANCE,
  };
  const barriers = latticeBarriers(input, lattice);
  const stops = turnStops(pts, scale);
  const grace = maxSkip + Math.max(2, Math.round(TURN_WINDOW_PX * scale));
  const ahead = straightRuns(pts, 1, capPoints, tolerance, barriers, stops, grace);
  const back = straightRuns(pts, -1, capPoints, tolerance, barriers, stops, grace);
  const legsAhead = Array.from(ahead, (count, i) => fitLeg(pts, i, count, 1));
  const legsBack = Array.from(back, (count, i) => fitLeg(pts, i, count, -1));
  const out: Candidate[] = [];
  for (let a = 0; a < n; a += 1) {
    let best: Candidate | null = null;
    for (let skip = 0; skip <= maxSkip; skip += 1) {
      // Skipped cracks are apex rounding (an acute tip's last pixel steps);
      // they may not hide a kept pixel feature (a leg corner that skipped
      // over a tooth would erase it).
      if (
        skip > 0 &&
        (barriers[(a + skip) % n] === KEPT_FEATURE || barriers[(a + skip + 1) % n] === KEPT_FEATURE)
      ) {
        break;
      }
      const b = (a + 1 + skip) % n;
      const candidate = legCorner(
        pts,
        a,
        skip,
        legsBack[a] as Leg,
        legsAhead[b] as Leg,
        scale,
        input.thresholdPx,
        input.measured,
      );
      if (candidate !== null && (best === null || candidate.cost > best.cost)) best = candidate;
    }
    if (best !== null) out.push(best);
  }
  return out;
}

// Longest straight run of points starting (step 1) or ending (step −1) at each
// index. Two pointers: a run from i+1 is at least the run from i minus one.
// A barrier at vertex v (between cracks v−1 and v) ends every run there.
function straightRuns(
  pts: ReadonlyArray<Vec2>,
  step: 1 | -1,
  cap: number,
  tolerance: LegTolerance,
  barriers: Uint8Array,
  stops: Uint8Array,
  grace: number,
): Int32Array {
  const n = pts.length;
  const runs = new Int32Array(n);
  // Vertex crossed when a run from i grows from `count` to `count + 1` points.
  const crossed = (i: number, count: number): number =>
    step === 1 ? (i + count) % n : (((i - count + 1) % n) + n) % n;
  // Lattice barriers always end a run; turn stops only past the leg's first
  // `grace` cracks (its own corner's rounding lies within them).
  const blocked = (i: number, count: number): boolean => {
    const vertex = crossed(i, count);
    return barriers[vertex] !== 0 || (count >= grace && stops[vertex] === 1);
  };
  let run = 1;
  for (let k = 0; k < n; k += 1) {
    const i = step === 1 ? k : n - 1 - k;
    run = Math.max(1, Math.min(cap, run - 1));
    // The carried run may now start across a barrier (it lost its first point).
    for (let c = 1; c < run; c += 1) {
      if (blocked(i, c)) {
        run = c;
        break;
      }
    }
    while (
      run < cap &&
      !blocked(i, run) &&
      (run < 2 || isStraight(pts, i, run + 1, step, tolerance))
    ) {
      run += 1;
    }
    runs[i] = run;
  }
  return runs;
}

function isStraight(
  pts: ReadonlyArray<Vec2>,
  i: number,
  count: number,
  step: 1 | -1,
  tolerance: LegTolerance,
): boolean {
  const leg = fitLeg(pts, i, count, step);
  const n = pts.length;
  const nx = -leg.dy;
  const ny = leg.dx;
  const first = pts[((i % n) + n) % n] as Vec2;
  const last = pts[(((i + (count - 1) * step) % n) + n) % n] as Vec2;
  const allowed = tolerance.base + tolerance.slope * Math.hypot(last.x - first.x, last.y - first.y);
  for (let k = 0; k < count; k += 1) {
    const p = pts[(((i + k * step) % n) + n) % n] as Vec2;
    if (Math.abs((p.x - leg.cx) * nx + (p.y - leg.cy) * ny) > allowed) return false;
  }
  return true;
}

// Total-least-squares line through `count` points from i in direction `step`,
// oriented along the chain's travel.
export function fitLeg(pts: ReadonlyArray<Vec2>, i: number, count: number, step: 1 | -1): Leg {
  const n = pts.length;
  const at = (k: number): Vec2 => pts[(((i + k * step) % n) + n) % n] as Vec2;
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < count; k += 1) {
    const p = at(k);
    cx += p.x;
    cy += p.y;
  }
  cx /= count;
  cy /= count;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let k = 0; k < count; k += 1) {
    const p = at(k);
    sxx += (p.x - cx) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
    syy += (p.y - cy) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const first = at(0);
  const last = at(count - 1);
  const travelX = (last.x - first.x) * step;
  const travelY = (last.y - first.y) * step;
  if (dx * travelX + dy * travelY < 0) {
    dx = -dx;
    dy = -dy;
  }
  // Smallest eigenvalue of the scatter matrix = residual sum of squares.
  const residualSq = Math.max(0, (sxx + syy - Math.hypot(sxx - syy, 2 * sxy)) / 2);
  return { count, cx, cy, dx, dy, residualSq };
}

function legCorner(
  pts: ReadonlyArray<Vec2>,
  a: number,
  skip: number,
  back: Leg,
  ahead: Leg,
  scale: number,
  thresholdPx: number,
  measured: boolean,
): Candidate | null {
  if (back.count < MIN_LEG_POINTS || ahead.count < MIN_LEG_POINTS) return null;
  const n = pts.length;
  if (back.count + ahead.count + skip > n) return null;
  const meeting = legMeeting(pts, a, skip, back, ahead, scale, measured);
  if (meeting === null) return null;
  const { apex, turn } = meeting;
  const b = (a + 1 + skip) % n;
  const farBack = pts[(((a - back.count + 1) % n) + n) % n] as Vec2;
  const farAhead = pts[(b + ahead.count - 1) % n] as Vec2;
  const legBack = Math.abs(along(back, apex) - along(back, farBack));
  const legAhead = Math.abs(along(ahead, farAhead) - along(ahead, apex));
  const leg = Math.min(legBack, legAhead, LEG_CAP_PX * scale);
  if (leg < MIN_LEG_PX * scale) return null;
  const filletGap = leg * Math.tan(Math.abs(turn) / 4);
  if (filletGap / scale <= thresholdPx) return null;
  // Two lines must explain the neighbourhood clearly better than ONE circle:
  // a digitized or wobbly arc fits a circle as well as it fits its own legs.
  const total = back.count + skip + ahead.count;
  const arcRms = circleRms(pts, (a - back.count + 1 + n) % n, total);
  const legRms = Math.sqrt((back.residualSq + ahead.residualSq) / (back.count + ahead.count));
  const cost = Math.min(filletGap, ARC_EXCESS_WEIGHT * Math.max(0, arcRms - legRms)) / scale;
  if (cost <= thresholdPx) return null;
  if (measured && claimsPixelCentre(pts, a, skip, apex, scale)) return null;
  return { from: a, skip, apex, cost, legBack: back.count, legAhead: ahead.count };
}

// Where the two legs meet, if they form a corner there: a well-conditioned
// intersection past the incoming leg's end and before the outgoing leg's
// start, standing off the skipped cracks by no more than the chamfer the
// pixels (or, measured, the anti-aliasing) can cut.
function legMeeting(
  pts: ReadonlyArray<Vec2>,
  a: number,
  skip: number,
  back: Leg,
  ahead: Leg,
  scale: number,
  measured: boolean,
): { readonly apex: Vec2; readonly turn: number } | null {
  const turn = Math.atan2(
    back.dx * ahead.dy - back.dy * ahead.dx,
    back.dx * ahead.dx + back.dy * ahead.dy,
  );
  // Near-parallel legs (a slight bend, or a U-turn round a stroke end) have no
  // well-conditioned intersection.
  if (Math.abs(turn) < MIN_LEG_TURN_RAD) return null;
  const apex = legIntersection(back, ahead);
  if (apex === null) return null;
  const n = pts.length;
  const slack = 0.5 * scale;
  if (along(back, apex) < along(back, pts[a] as Vec2) - slack) return null;
  if (along(ahead, apex) > along(ahead, pts[(a + 1 + skip) % n] as Vec2) + slack) return null;
  const interior = Math.PI - Math.abs(turn);
  const base = measured ? APEX_STANDOFF_MEASURED_BASE_PX : APEX_STANDOFF_BASE_PX;
  const acute = measured ? APEX_STANDOFF_MEASURED_ACUTE_PX : APEX_STANDOFF_ACUTE_PX;
  const standoff = (base + acute / Math.max(0.1, Math.sin(interior / 2))) * scale;
  return distanceToGap(pts, a, skip, apex) > standoff ? null : { apex, turn };
}

// Measured loops: the crack chain is the iso-line of the pre-threshold field,
// so every source pixel centre already lies on its own class's side of it. The
// region an apex swaps between ink and paper — bounded by the chain from `a`
// through the skipped cracks to `a + skip + 1`, and the apex — may therefore
// hold no pixel centre: one inside would change class, and the corner would
// contradict the measurement (on dense art it is usually a neighbour's pixel,
// and the corner would cut into that outline). Binary chains are mid-crack
// approximations whose true corner may lie well past them (an acute tip), so
// the test does not apply there.
function claimsPixelCentre(
  pts: ReadonlyArray<Vec2>,
  a: number,
  skip: number,
  apex: Vec2,
  scale: number,
): boolean {
  const n = pts.length;
  const ring: Vec2[] = [];
  for (let k = 0; k <= skip + 1; k += 1) ring.push(pts[(a + k) % n] as Vec2);
  ring.push(apex);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  // SOURCE pixel centres: a supersampled field between them is interpolated,
  // not measured.
  for (let y = (Math.ceil(minY / scale - 0.5) + 0.5) * scale; y < maxY; y += scale) {
    for (let x = (Math.ceil(minX / scale - 0.5) + 0.5) * scale; x < maxX; x += scale) {
      if (strictlyInside(ring, x, y)) return true;
    }
  }
  return false;
}

// Even-odd point in polygon; points on an edge count as outside.
function strictlyInside(ring: ReadonlyArray<Vec2>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const p = ring[i] as Vec2;
    const q = ring[j] as Vec2;
    if (pointToSegment({ x, y }, p, q) < 1e-9) return false;
    if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
  }
  return inside;
}

function along(leg: Leg, p: Vec2): number {
  return (p.x - leg.cx) * leg.dx + (p.y - leg.cy) * leg.dy;
}

function distanceToGap(pts: ReadonlyArray<Vec2>, a: number, skip: number, p: Vec2): number {
  const n = pts.length;
  let best = Infinity;
  for (let k = 0; k <= skip; k += 1) {
    const u = pts[(a + k) % n] as Vec2;
    const v = pts[(a + k + 1) % n] as Vec2;
    best = Math.min(best, pointToSegment(p, u, v));
  }
  return best;
}

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t =
    len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// RMS radial residual of the algebraic (Kåsa 1976) least-squares circle
// through `count` consecutive points from `start`. A near-straight set yields
// a huge radius whose residual equals the line residual.
function circleRms(pts: ReadonlyArray<Vec2>, start: number, count: number): number {
  const n = pts.length;
  const at = (k: number): Vec2 => pts[(start + k) % n] as Vec2;
  let mx = 0;
  let my = 0;
  for (let k = 0; k < count; k += 1) {
    mx += at(k).x;
    my += at(k).y;
  }
  mx /= count;
  my /= count;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (let k = 0; k < count; k += 1) {
    const u = at(k).x - mx;
    const v = at(k).y - my;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return 0;
  const r1 = 0.5 * (suuu + suvv);
  const r2 = 0.5 * (svvv + svuu);
  const uc = (r1 * svv - r2 * suv) / det;
  const vc = (r2 * suu - r1 * suv) / det;
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / count);
  let sumSq = 0;
  for (let k = 0; k < count; k += 1) {
    const d = Math.hypot(at(k).x - mx - uc, at(k).y - my - vc);
    sumSq += (d - radius) ** 2;
  }
  return Math.sqrt(sumSq / count);
}

export function growLeg(
  pts: ReadonlyArray<Vec2>,
  start: number,
  step: 1 | -1,
  limit: number,
  tolerance: LegTolerance,
): number {
  let count = Math.min(limit, 2);
  while (count < limit && isStraight(pts, start, count + 1, step, tolerance)) count += 1;
  return count;
}

export function legIntersection(back: Leg, ahead: Leg): Vec2 | null {
  const cross = back.dx * ahead.dy - back.dy * ahead.dx;
  if (Math.abs(cross) < Math.sin(MIN_LEG_TURN_RAD)) return null;
  const t = ((ahead.cx - back.cx) * ahead.dy - (ahead.cy - back.cy) * ahead.dx) / cross;
  return { x: back.cx + t * back.dx, y: back.cy + t * back.dy };
}
