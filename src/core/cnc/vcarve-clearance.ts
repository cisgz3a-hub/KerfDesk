// vcarveClearanceToolpaths — the two-stage v-carve's first stage (Phase
// H.7, closing the deferred marker in vcarve-ladder.ts). Where a region is
// wider than the v-bit can reach at max depth, the ladder clamps and floods
// a flat floor with δ-spaced rings — slow, and a v-tip is the wrong bit for
// floor clearing. This stage pockets exactly those flat-floor regions with
// a flat clearing bit: the region boundary is the inward offset at
// inset = maxDepth · tan(θ/2) (where the ladder's depth law hits the
// clamp), and the pocket engine fills it at the clearing bit's stepover.
// The v-bit ladder then runs unchanged over the whole shape — its clamped
// rings recut a hair of the cleared floor, which is the safe overlap
// direction.

import { offsetClosedPolylinesForKerf } from '../geometry/kerf-offset';
import type { CncTool, Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';
import { pocketToolpathRings } from './pocket-paths';

const MIN_CLOSED_POINTS = 3;
const FALLBACK_TIP_ANGLE_DEG = 60;

export type VCarveClearanceOptions = {
  readonly vBit: CncTool;
  readonly clearTool: CncTool;
  readonly maxDepthMm: number;
  readonly stepoverPercent: number;
};

export function vcarveClearanceToolpaths(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveClearanceOptions,
): ReadonlyArray<Polyline> {
  if (!(options.maxDepthMm > 0)) return [];
  const contours = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  if (contours.length === 0) return [];
  const tipAngleDeg =
    options.vBit.tipAngleDeg !== undefined && options.vBit.tipAngleDeg > 0
      ? options.vBit.tipAngleDeg
      : FALLBACK_TIP_ANGLE_DEG;
  const clampInsetMm = options.maxDepthMm * Math.tan((tipAngleDeg * Math.PI) / 360);
  // The flat-floor region: everything deeper than the clamp inset. Narrow
  // shapes offset away entirely — clipper returns nothing and there is no
  // clearance stage.
  const floorRegions = offsetClosedPolylinesForKerf(contours, -clampInsetMm);
  if (floorRegions.length === 0) return [];
  return pocketToolpathRings(floorRegions, options.clearTool.diameterMm, options.stepoverPercent);
}
