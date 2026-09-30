// Leg evidence for the corner dial (ADR-439): two straight legs meeting at a
// turn, their intersection as the apex, and the rounding cost of that corner.

import type { Vec2 } from '../scene';
import { hypot2 } from '../geometry/fast-hypot';
import { fitCircle } from './contour-corner-circle';
import { fieldConfirmsWedge, wedgeFieldFit } from './contour-corner-field';
import { latticeBarriers } from './contour-corner-lattice';
import {
  LEG_SLOPE_TOLERANCE,
  straightLegs,
  type Leg,
  type LegTolerance,
} from './contour-corner-leg-runs';
import {
  KEPT_FEATURE,
  LEG_CAP_PX,
  MIN_LEG_POINTS,
  MIN_LEG_TURN_RAD,
  POINTS_PER_PX,
  type Candidate,
  type CornerDialInput,
} from './contour-corner-types';
import type { CrackSubPixelField } from './saddle-connectivity';

// Leg straightness: the largest perpendicular residual a leg may carry. Binary
// cracks of a digital straight line scatter up to ~±0.25 px about their line,
// and a thresholded edge adds its own wobble; measured (sub-pixel) cracks
// carry ~0.1 px noise.
const LEG_TOLERANCE_BINARY_PX = 0.5;
const LEG_TOLERANCE_MEASURED_PX = 0.2;
const MIN_LEG_PX = 1;
// A leg corner may skip a few cracks of apex rounding (anti-aliasing,
// supersampling) that fit neither leg.
const MAX_SKIP_PX = 2;
// The apex may stand off the crack chain by the chamfer the pixels cut, which
// grows as the interior angle closes.
const APEX_STANDOFF_BASE_PX = 0.9;
const APEX_STANDOFF_ACUTE_PX = 0.5;
// A measured chain is the field's own iso-line, rounded only by the source's
// anti-aliasing. Its hidden apex stands off by what a one-pixel box filter
// rounds away plus what the crack sampling chords off, not by a pixel chamfer:
// the half-coverage iso-line of a box-filtered corner of interior angle A
// recedes from the apex by 0.25 / tan(A / 2) (0.293 px at 90 degrees, 0.93 px
// at 30), and the chord through the lattice cracks nearest the tip cuts up to
// 0.3 / sin(A / 2) further in (measured on the bake-off's anti-aliased wedges,
// stars and rectangles: the distance past the filter recession, times
// sin(A / 2), stays at 0.18..0.29 px for 30..120 degrees). That allowance alone
// gives organic tips on the owl and hummingbird apexes that cut into their
// neighbours (first-round topology conflicts 75 -> 190 on the owl's Line Art),
// so an apex past the tight allowance, the one tuned against those conflicts,
// must also be confirmed by the field (contour-corner-field.ts). A threshold
// off half coverage (Otsu puts Sharp and Smooth at 97 of 255 on an
// anti-aliased rectangle) moves the iso-line and the chord through the tip
// cracks a little further off: the calibration rectangle's corner stood
// 0.704 px off against the 0.674 px allowance, so the loose allowance takes a
// further 0.1 / sin(A / 2). Only the field's confirmation lets such an apex in.
const APEX_STANDOFF_MEASURED_BASE_PX = 0.3;
const APEX_STANDOFF_MEASURED_ACUTE_PX = 0.15;
const APEX_STANDOFF_MEASURED_FILTER_PX = 0.25;
const APEX_STANDOFF_MEASURED_SAMPLING_PX = 0.3;
const APEX_STANDOFF_MEASURED_LEVEL_PX = 0.1;
// Weight of the one-circle model's excess RMS residual over the two-leg
// model's in the cost cap (see header).
const ARC_EXCESS_WEIGHT = 10;

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
  const legs = straightLegs(pts, { cap: capPoints, maxSkip, scale, tolerance, barriers });
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
        legs.back[a] as Leg,
        legs.ahead[b] as Leg,
        scale,
        input.thresholdPx,
        input.measured,
        input.field,
      );
      if (candidate !== null && (best === null || candidate.cost > best.cost)) best = candidate;
    }
    if (best !== null) out.push(best);
  }
  return out;
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
  field: CrackSubPixelField | undefined,
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
  if (measured && !measuredApexStands(pts, a, skip, apex, back, ahead, scale, meeting, field)) {
    return null;
  }
  return { from: a, skip, apex, cost, legBack: back.count, legAhead: ahead.count };
}

// A measured apex past the tight standoff, or over a pixel centre, stands only
// if the field looks like the box-filtered wedge its legs bound.
function measuredApexStands(
  pts: ReadonlyArray<Vec2>,
  a: number,
  skip: number,
  apex: Vec2,
  back: Leg,
  ahead: Leg,
  scale: number,
  meeting: LegMeeting,
  field: CrackSubPixelField | undefined,
): boolean {
  if (!meeting.confirm && !claimsPixelCentre(pts, a, skip, apex, scale)) return true;
  if (field === undefined) return false;
  return fieldConfirmsWedge(wedgeFieldFit(field, apex, back, ahead, scale));
}

type LegMeeting = {
  readonly apex: Vec2;
  readonly turn: number;
  /** The apex stands past the tight allowance: the field must confirm it. */
  readonly confirm: boolean;
};

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
): LegMeeting | null {
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
  const dist = distanceToGap(pts, a, skip, apex);
  if (!measured) {
    const standoff =
      (APEX_STANDOFF_BASE_PX + APEX_STANDOFF_ACUTE_PX / Math.max(0.1, Math.sin(interior / 2))) *
      scale;
    return dist > standoff ? null : { apex, turn, confirm: false };
  }
  const tight =
    (APEX_STANDOFF_MEASURED_BASE_PX +
      APEX_STANDOFF_MEASURED_ACUTE_PX / Math.max(0.1, Math.sin(interior / 2))) *
    scale;
  const half = Math.max(0.05, interior / 2);
  const loose =
    (APEX_STANDOFF_MEASURED_FILTER_PX / Math.tan(half) +
      (APEX_STANDOFF_MEASURED_SAMPLING_PX + APEX_STANDOFF_MEASURED_LEVEL_PX) / Math.sin(half)) *
    scale;
  if (dist > Math.max(tight, loose)) return null;
  return { apex, turn, confirm: dist > tight };
}

// Measured loops: the crack chain is the iso-line of the pre-threshold field,
// so every source pixel centre already lies on its own class's side of it. The
// region an apex swaps between ink and paper — bounded by the chain from `a`
// through the skipped cracks to `a + skip + 1`, and the apex — may therefore
// hold no pixel centre: one inside would change class, and the corner would
// contradict the measurement (on dense art it is usually a neighbour's pixel,
// and the corner would cut into that outline). Binary chains are mid-crack
// approximations whose true corner may lie well past them (an acute tip), so
// the test does not apply there. Pixel centres close to an acute anti-aliased
// tip legitimately read as paper, so a claim is waived when the field confirms
// the wedge (legCorner).
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
  return hypot2(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// RMS radial residual of the one-circle model through `count` consecutive
// points from `start`. A near-straight set yields a huge radius whose residual
// equals the line residual (an exactly straight one, 0).
function circleRms(pts: ReadonlyArray<Vec2>, start: number, count: number): number {
  return fitCircle(pts, start, count)?.rms ?? 0;
}

export function legIntersection(back: Leg, ahead: Leg): Vec2 | null {
  const cross = back.dx * ahead.dy - back.dy * ahead.dx;
  if (Math.abs(cross) < Math.sin(MIN_LEG_TURN_RAD)) return null;
  const t = ((ahead.cx - back.cx) * ahead.dy - (ahead.cy - back.cy) * ahead.dx) / cross;
  return { x: back.cx + t * back.dx, y: back.cy + t * back.dy };
}
