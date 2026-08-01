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

import { insetContoursChecked } from '../geometry/offset-ladder';
import type { CncTool, Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';
import { pocketRingToolpaths, type PocketToolpaths } from './pocket-paths';
import { vcarveIncludedAngleDeg } from './vcarve-angle';

const MIN_CLOSED_POINTS = 3;

export type VCarveClearanceOptions = {
  readonly vBit: CncTool;
  readonly clearTool: CncTool;
  readonly maxDepthMm: number;
  readonly stepoverPercent: number;
};

type VCarveFloorOptions = Pick<VCarveClearanceOptions, 'vBit' | 'maxDepthMm'>;

export function vcarveHasFlatFloor(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveFloorOptions,
): boolean {
  return vcarveClearanceFloor(polylines, options).contours.length > 0;
}

export function vcarveClearanceToolpaths(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveClearanceOptions,
): ReadonlyArray<Polyline> {
  return vcarveClearancePocket(polylines, options).toolpaths;
}

// Same toolpaths, keeping the reason the clearing pocket ended: both the
// flat-floor inset and the pocket ladder below it return nothing on an
// offset-engine failure, which is indistinguishable from "the shape is too
// narrow to need a clearing stage" unless the failure is carried out.
export function vcarveClearancePocket(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveClearanceOptions,
): PocketToolpaths {
  const floorRegions = vcarveClearanceFloor(polylines, options);
  if (floorRegions.contours.length === 0) {
    return { toolpaths: [], offsetFailed: floorRegions.offsetFailed };
  }
  return pocketRingToolpaths(
    floorRegions.contours,
    options.clearTool.diameterMm,
    options.stepoverPercent,
  );
}

function vcarveClearanceFloor(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveFloorOptions,
): { readonly contours: ReadonlyArray<Polyline>; readonly offsetFailed: boolean } {
  const tipAngleDeg = vcarveIncludedAngleDeg(options.vBit);
  if (tipAngleDeg === null) return NO_FLOOR;
  if (!(options.maxDepthMm > 0)) return NO_FLOOR;
  const contours = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  if (contours.length === 0) return NO_FLOOR;
  const clampInsetMm = options.maxDepthMm * Math.tan((tipAngleDeg * Math.PI) / 360);
  // The flat-floor region: everything deeper than the clamp inset. Narrow
  // shapes offset away entirely — clipper returns nothing and there is no
  // clearance stage.
  return insetContoursChecked(contours, clampInsetMm);
}

const NO_FLOOR = { contours: [], offsetFailed: false } as const;
