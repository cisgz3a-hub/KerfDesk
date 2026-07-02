// pocketToolpathRings — contour-parallel pocket clearing.
//
// A pocket removes all material inside closed shapes. We generate successive
// inward offsets of the boundary ("rings"): ring 0 is inset by the tool
// radius (the finishing wall), ring k by radius + k * stepover. Rings are
// emitted innermost-first so the bulk is cleared before the finishing ring
// runs along the wall. Islands (holes inside the pocket contour) are handled
// by the containment-aware offset: hole boundaries grow as the outer shrinks,
// so rings never enter the island.
//
// Each ring offsets from the ORIGINAL contours (not the previous ring) to
// avoid accumulating clipper approximation error across many rings.

import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import type { Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';

const MIN_CLOSED_POINTS = 3;
const MIN_STEPOVER_PERCENT = 10;
const MAX_STEPOVER_PERCENT = 85;
// Backstop against degenerate inputs (huge pocket + microscopic stepover).
// 4096 rings × stepover ≥ 0.1 × diameter covers any real bed.
const MAX_POCKET_RINGS = 4096;

export function pocketToolpathRings(
  polylines: ReadonlyArray<Polyline>,
  toolDiameterMm: number,
  stepoverPercent: number,
): ReadonlyArray<Polyline> {
  const contours = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  if (contours.length === 0 || !(toolDiameterMm > 0)) return [];
  const radius = toolDiameterMm / 2;
  const stepover = clampStepoverPercent(stepoverPercent);
  const stepMm = (stepover / 100) * toolDiameterMm;

  const rings: Array<ReadonlyArray<Polyline>> = [];
  for (let k = 0; k < MAX_POCKET_RINGS; k += 1) {
    const inset = radius + k * stepMm;
    const ring = offsetClosedPolylinesForKerf(contours, -inset);
    if (ring.length === 0) break;
    rings.push(ring);
  }

  // Innermost ring first, boundary (ring 0) last as the finishing pass.
  const out: Polyline[] = [];
  for (let k = rings.length - 1; k >= 0; k -= 1) {
    const ring = rings[k];
    if (ring !== undefined) out.push(...ring);
  }
  return out;
}

function clampStepoverPercent(stepoverPercent: number): number {
  if (!Number.isFinite(stepoverPercent)) return MIN_STEPOVER_PERCENT;
  return Math.min(MAX_STEPOVER_PERCENT, Math.max(MIN_STEPOVER_PERCENT, stepoverPercent));
}
