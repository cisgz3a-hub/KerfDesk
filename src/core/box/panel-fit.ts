// panel-fit — bakes the two generator-owned fit corrections into a panel's
// rings (ADR-106, multi-ring since ADR-116): joint clearance as a uniform
// contour offset, then CNC corner-overcut reliefs at the seat-critical
// corners. Laser kerf compensation and CNC cutter compensation stay in the
// shipped pipeline (kerf-offset at compile / profile-paths) — never
// duplicated here.
//
// Offset derivation: a uniform inward offset δ narrows every tab by 2δ AND
// widens the mating recess by 2δ, so the joint play is 4δ. The ADR-106
// contract is play == clearance c, hence δ = c/4 inward (a negative c grows
// tabs into a press fit). Interior cutouts ride the same offset: shrinking
// material WIDENS every slot by c/4 per flank — exactly the slot play the
// contract requires. Reliefs subtract AFTER the offset so every relief
// circle keeps the full bit radius (offsetting afterwards would shrink the
// relief below the tool diameter and the bit could not follow it).
//
// Relief placement (ADR-106 Amd 1): each relief is a dogbone — a circle a
// hair wider than the bit whose centre sits one bit radius from the corner
// along the bisector of the open (waste) side. The bit's own centre can run
// in along that bisector until its edge touches the corner. A bit-radius
// circle centred ON the corner cannot be reached at all: any bit centre
// short of the exact corner gouges the recess walls, so the compensated
// toolpath skipped it and every seat kept a bit-radius fillet.

import { differenceD, FillRule, type PathD, type PathsD } from 'clipper2-ts';
import type { Polyline, Vec2 } from '../scene';
import { offsetClosedPolylinesForKerfChecked } from '../geometry/kerf-offset';
import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import { pathDToPolyline, polylineToPathD, tryVectorOp } from '../geometry/vector-path-tools';
import type { BoxRelief } from './box-spec';

const CIRCLE_SEGMENTS = 24;
// Extra relief radius beyond the bit. The bit's approach lane into a
// dogbone is only about this wide at its tip, so it must sit well above
// clipper's 1e-3 mm rounding and the 5 µm segment floor; the bit edge then
// reaches this far past the corner.
const RELIEF_REACH_MARGIN_MM = 0.05;
// Keep relief booleans at the offset precision (1e-3 mm), not clipper's
// default 1e-2, which can pinch the approach lane shut.
const RELIEF_PRECISION_DECIMALS = 3;
// δ = c/4 inward per the play derivation in the header.
const CLEARANCE_TO_OFFSET_FACTOR = -0.25;
const REFLEX_CROSS_EPS = 1e-9;

export type PanelRings = {
  readonly outline: Polyline;
  /** Closed interior rings (slots, holes) inside the outline (ADR-116). */
  readonly cutouts: ReadonlyArray<Polyline>;
};

export type PanelFitArgs = {
  readonly clearanceMm: number;
  readonly relief: BoxRelief;
};

export type PanelFitResult =
  | ({ readonly kind: 'fitted' } & PanelRings)
  | { readonly kind: 'degenerate'; readonly detail: string };

/**
 * Apply clearance then corner relief to one panel's rings. At clearance 0
 * with no relief the input is returned bit-identical (the nominal laser
 * path keeps the exact shared-float boundaries the assembly referee relies
 * on).
 */
export function applyPanelFit(rings: PanelRings, args: PanelFitArgs): PanelFitResult {
  const offset = offsetRings(rings, args.clearanceMm);
  if (offset.kind !== 'fitted' || args.relief.kind === 'none') return offset;
  return subtractCornerReliefs(offset, args.relief.toolDiameterMm / 2);
}

function offsetRings(rings: PanelRings, clearanceMm: number): PanelFitResult {
  if (clearanceMm === 0) return { kind: 'fitted', ...rings };
  const operation = `clearance ${clearanceMm} mm`;
  const topology = normalizeClosedPolylineTreeEvenOddChecked([rings.outline, ...rings.cutouts]);
  if (topology.kind === 'error') return { kind: 'degenerate', detail: `${operation} failed` };
  const roots = topology.value.filter((node) => node.parentIndex === null);
  const holes = topology.value.filter((node) => node.isHole && node.parentIndex !== null);
  if (
    topology.value.length !== rings.cutouts.length + 1 ||
    roots.length !== 1 ||
    holes.length !== rings.cutouts.length
  ) {
    return { kind: 'degenerate', detail: `${operation} severed the panel` };
  }
  // Checked: the unchecked variant flattens a clipper failure to an empty list,
  // which classifyRings can only read as "consumed the panel" — and generate-box
  // puts that detail straight in front of the operator, so if it ever fires it
  // sends them to edit a clearance that was never the problem. Panels are
  // synthesised from a validated box spec, so this is defensive rather than a
  // reachable bug today; it exists so both clipper calls in this file report a
  // failure the same way (subtractCornerReliefs below already does).
  const results = offsetClosedPolylinesForKerfChecked(
    [rings.outline, ...rings.cutouts],
    clearanceMm * CLEARANCE_TO_OFFSET_FACTOR,
  );
  if (results.kind === 'error') return { kind: 'degenerate', detail: `${operation} failed` };
  return classifyRings(results.value, rings, operation);
}

// Subtract a dogbone at every seat-critical corner — outline reflex corners
// plus cutout convex corners (a slot corner a mating tab must seat against).
// A panel with no recesses and no cutouts has no such corners; that is a
// valid butt-joint face and stays untouched.
function subtractCornerReliefs(rings: PanelRings, radiusMm: number): PanelFitResult {
  const outline = orient(polylineToPathD(rings.outline), true);
  const holes = rings.cutouts.map((cutout) => orient(polylineToPathD(cutout), false));
  const circles: PathsD = [
    // CCW outline: right turns are reflex material corners.
    ...seatCorners(outline, false),
    // Each hole as its own CCW ring: left turns are convex slot corners,
    // i.e. reflex corners of the surrounding material.
    ...holes.map((hole) => seatCorners(orient(hole, true), true)),
  ]
    .flat()
    .map((corner) => dogbonePath(corner, radiusMm));
  if (circles.length === 0) return { kind: 'fitted', ...rings };
  // clipper2-ts can throw internally on pathological geometry; catch it here so
  // it never escapes the pure core and aborts the box generator (R6). A failed
  // subtraction reports as degenerate, the same contract classifyRings uses.
  const relieved = tryVectorOp(() =>
    differenceD([outline, ...holes], circles, FillRule.NonZero, RELIEF_PRECISION_DECIMALS),
  );
  if (relieved.kind === 'error') {
    return { kind: 'degenerate', detail: `corner relief r=${radiusMm} mm failed` };
  }
  return classifyRings(
    relieved.value.map(pathDToPolyline),
    rings,
    `corner relief r=${radiusMm} mm`,
  );
}

// The outline is the ring that contains all the others — with our geometry
// (cutouts strictly inside the outline) that is exactly the largest-|area|
// ring, independent of the winding clipper hands back. A changed ring count
// means the panel was severed or consumed — never a silent drop.
function classifyRings(
  results: ReadonlyArray<Polyline>,
  input: PanelRings,
  operation: string,
): PanelFitResult {
  if (results.length !== input.cutouts.length + 1) {
    return {
      kind: 'degenerate',
      detail: `${operation} ${results.length === 0 ? 'consumed the panel' : 'severed the panel'}`,
    };
  }
  let outline = results[0];
  for (const ring of results) {
    if (outline === undefined || ringArea(ring) > ringArea(outline)) outline = ring;
  }
  if (outline === undefined) {
    return { kind: 'degenerate', detail: `${operation} consumed the panel` };
  }
  const picked = outline;
  return { kind: 'fitted', outline: picked, cutouts: results.filter((ring) => ring !== picked) };
}

function ringArea(ring: Polyline): number {
  return Math.abs(signedArea(polylineToPathD(ring)));
}

type SeatCorner = {
  readonly at: Vec2;
  /** Unit bisector of the open (waste) wedge between the corner's two edges. */
  readonly open: Vec2;
};

// Seat-critical corners of one CCW ring: right turns (material reflex) on
// the outline, left turns (convex slot corner) when scanning a hole. Either
// way the open side is the wedge between the rays back to the previous
// vertex and on to the next one.
function seatCorners(ring: PathD, convex: boolean): ReadonlyArray<SeatCorner> {
  const corners: SeatCorner[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    const prev = ring[(i + n - 1) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    if (prev === undefined || curr === undefined || next === undefined) continue;
    const inX = curr.x - prev.x;
    const inY = curr.y - prev.y;
    const outX = next.x - curr.x;
    const outY = next.y - curr.y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    const cross = inX * outY - inY * outX;
    const threshold = REFLEX_CROSS_EPS * inLength * outLength;
    if (!(convex ? cross > threshold : cross < -threshold)) continue;
    const open = unit({
      x: outX / outLength - inX / inLength,
      y: outY / outLength - inY / inLength,
    });
    if (open !== null) corners.push({ at: { x: curr.x, y: curr.y }, open });
  }
  return corners;
}

function orient(ring: PathD, ccw: boolean): PathD {
  return signedArea(ring) >= 0 === ccw ? ring : [...ring].reverse();
}

function signedArea(ring: PathD): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function unit(v: Vec2): Vec2 | null {
  const length = Math.hypot(v.x, v.y);
  return length > 0 ? { x: v.x / length, y: v.y / length } : null;
}

// A polygon circumscribing the (bit radius + margin) circle, centred one bit
// radius out along the open bisector: a bit centred there touches the corner.
function dogbonePath(corner: SeatCorner, bitRadiusMm: number): PathD {
  const center = {
    x: corner.at.x + bitRadiusMm * corner.open.x,
    y: corner.at.y + bitRadiusMm * corner.open.y,
  };
  const vertexRadiusMm =
    (bitRadiusMm + RELIEF_REACH_MARGIN_MM) / Math.cos(Math.PI / CIRCLE_SEGMENTS);
  const points: PathD = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    points.push({
      x: center.x + vertexRadiusMm * Math.cos(angle),
      y: center.y + vertexRadiusMm * Math.sin(angle),
    });
  }
  return points;
}
