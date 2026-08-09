// vcarveClearanceToolpaths — the two-stage V-carve's first stage. Where a
// flat-depth region is wider than the V-bit can reach at that depth, the
// medial plan has a flat core, and a V-tip is the wrong bit for bulk floor
// clearing. This stage pockets exactly that core with a flat clearing bit:
// the region boundary is the inward offset at the requested-depth radial
// envelope footprint. The pocket engine fills it at the clearing bit's stepover. The V-bit's
// medial and flat-core routes still cover the whole shape with a small
// overlap into the cleared floor.

import { insetContoursChecked } from '../geometry/offset-ladder';
import type { CncTool, Polyline } from '../scene';
import { hasFinitePoints } from './profile-paths';
import { pocketRingToolpaths, type PocketToolpaths } from './pocket-paths';
import { vcarveIncludedAngleDeg } from './vcarve-angle';
import { conicalRadialEnvelope, radialEnvelopeFootprintMm } from './radial-envelope';

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
// flat-floor inset and the pocket paths below it return nothing on an
// offset-engine failure, which is indistinguishable from "the shape is too
// narrow to need a clearing stage" unless the failure is carried out.
export function vcarveClearancePocket(
  polylines: ReadonlyArray<Polyline>,
  options: VCarveClearanceOptions,
): PocketToolpaths {
  const floorRegions = vcarveClearanceFloor(polylines, options);
  if (floorRegions.contours.length === 0) {
    return {
      toolpaths: [],
      offsetFailed: floorRegions.offsetFailed,
      passLimited: false,
      stepoverUsed: false,
    };
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
  const envelope = conicalRadialEnvelope(options.vBit, tipAngleDeg);
  if (envelope === null) return NO_FLOOR;
  const contours = polylines.filter(
    (polyline) =>
      polyline.closed && polyline.points.length >= MIN_CLOSED_POINTS && hasFinitePoints(polyline),
  );
  if (contours.length === 0) return NO_FLOOR;
  // Keep the historical over-cone behavior: a requested depth past the flank
  // does not activate a secondary clearing stage or widen its existing
  // preflight refusal scope. The medial planner independently caps executable
  // V-carve depth at the physical flank height.
  const clampInsetMm = radialEnvelopeFootprintMm(envelope, options.maxDepthMm);
  // The flat-floor region: everything deeper than the clamp inset. Narrow
  // shapes offset away entirely — clipper returns nothing and there is no
  // clearance stage.
  return insetContoursChecked(contours, clampInsetMm);
}

const NO_FLOOR = { contours: [], offsetFailed: false } as const;
