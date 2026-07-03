// panel-fit — bakes the two generator-owned fit corrections into a panel
// outline (ADR-105): joint clearance as a uniform contour offset, then CNC
// corner-overcut reliefs at the seat-critical reflex corners. Laser kerf
// compensation and CNC cutter compensation stay in the shipped pipeline
// (kerf-offset at compile / profile-paths) — never duplicated here.
//
// Offset derivation: a uniform inward offset δ narrows every tab by 2δ AND
// widens the mating recess by 2δ, so the joint play is 4δ. The ADR-105
// contract is play == clearance c, hence δ = c/4 inward (a negative c grows
// tabs into a press fit). Reliefs subtract AFTER the offset so every relief
// circle keeps the full bit radius (offsetting afterwards would shrink the
// relief below the tool diameter and the bit could not follow it).

import { differenceD, FillRule, type PathD, type PathsD } from 'clipper2-ts';
import type { Polyline, Vec2 } from '../scene';
import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import { pathDToPolyline, polylineToPathD } from '../geometry/vector-path-tools';
import type { BoxRelief } from './box-spec';

// dogbone.ts precedent: 24-segment relief circles, F-CNC26 corner-overcut.
const CIRCLE_SEGMENTS = 24;
// δ = c/4 inward per the play derivation in the header.
const CLEARANCE_TO_OFFSET_FACTOR = -0.25;
const REFLEX_CROSS_EPS = 1e-9;

export type PanelFitArgs = {
  readonly clearanceMm: number;
  readonly relief: BoxRelief;
};

export type PanelFitResult =
  | { readonly kind: 'fitted'; readonly outline: Polyline }
  | { readonly kind: 'degenerate'; readonly detail: string };

/**
 * Apply clearance then corner relief to one panel outline. At clearance 0
 * with no relief the input is returned bit-identical (the nominal laser path
 * keeps the exact shared-float boundaries the assembly referee relies on).
 */
export function applyPanelFit(outline: Polyline, args: PanelFitArgs): PanelFitResult {
  const offset = offsetOutline(outline, args.clearanceMm);
  if (offset.kind !== 'fitted' || args.relief.kind === 'none') return offset;
  return subtractCornerReliefs(offset.outline, args.relief.toolDiameterMm / 2);
}

function offsetOutline(outline: Polyline, clearanceMm: number): PanelFitResult {
  if (clearanceMm === 0) return { kind: 'fitted', outline };
  const results = offsetClosedPolylinesForKerf([outline], clearanceMm * CLEARANCE_TO_OFFSET_FACTOR);
  const first = results[0];
  if (first === undefined || results.length !== 1) {
    return {
      kind: 'degenerate',
      detail: `clearance ${clearanceMm} mm ${results.length === 0 ? 'consumed the panel' : 'split the panel'}`,
    };
  }
  return { kind: 'fitted', outline: first };
}

// Subtract a full-radius circle centered on every reflex (inward, 270°-ish)
// corner — exactly the corners a mating square tab or corner square must
// seat against. A panel with no recesses has no reflex corners; that is a
// valid butt-joint face and stays untouched.
function subtractCornerReliefs(outline: Polyline, radiusMm: number): PanelFitResult {
  const ring = orientCcw(polylineToPathD(outline));
  const circles: PathsD = reflexCorners(ring).map((corner) => circlePath(corner, radiusMm));
  if (circles.length === 0) return { kind: 'fitted', outline };
  const relieved = differenceD([ring], circles, FillRule.NonZero);
  const first = relieved[0];
  if (first === undefined || relieved.length !== 1) {
    return {
      kind: 'degenerate',
      detail: `corner relief r=${radiusMm} mm ${relieved.length === 0 ? 'consumed the panel' : 'severed the panel'}`,
    };
  }
  return { kind: 'fitted', outline: pathDToPolyline(first) };
}

function reflexCorners(ring: PathD): ReadonlyArray<Vec2> {
  const corners: Vec2[] = [];
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
    const cross = inX * outY - inY * outX;
    const scale = Math.hypot(inX, inY) * Math.hypot(outX, outY);
    // CCW ring: a right turn (negative cross) is a reflex material corner.
    if (cross < -REFLEX_CROSS_EPS * scale) corners.push({ x: curr.x, y: curr.y });
  }
  return corners;
}

function orientCcw(ring: PathD): PathD {
  return signedArea(ring) >= 0 ? ring : [...ring].reverse();
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

function circlePath(center: Vec2, radiusMm: number): PathD {
  const points: PathD = [];
  for (let i = 0; i < CIRCLE_SEGMENTS; i += 1) {
    const angle = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    points.push({
      x: center.x + radiusMm * Math.cos(angle),
      y: center.y + radiusMm * Math.sin(angle),
    });
  }
  return points;
}
