import type { CncPass } from '../job';
import type { Polyline, Vec2 } from '../scene';
import {
  buildVCarveBoundarySegmentIndex,
  type VCarveBoundarySegmentIndex,
} from './vcarve-boundary-segment-index';
import { zPassDepths } from './depth-passes';
import { certifiedVCarveDepthSteppedPasses } from './vcarve-depth-stepped-passes';
import {
  detailPath3dPlan,
  sourceBoundarySegments,
  vcarveEmittedDepthAtPoint,
  type DetailDepthLaw,
} from './vcarve-detail-depth';
import type { VCarveOptions } from './vcarve-ladder';
import { vcarveEmittedProfileCovers, vcarveRoutePrecisionMet } from './vcarve-emitted-profile';
import type { VCarveMedialRegionGeometryPlan } from './vcarve-medial-region-plan';

const MEDIAL_Z_TOLERANCE_MM = 0.05;
// Ten microns is the emitted CAM-footprint tolerance. It is checked against
// the actual 0.001 mm XYZ program, not an analytic shortcut.
const MEDIAL_SWEEP_TOLERANCE_MM = 0.01;
// A tighter local search avoids proposing an over-aggressive shortcut; the
// final reference-to-compact certificate below still owns the one 0.01 mm budget.
const MEDIAL_COMPACTION_TOLERANCE_MM = 0.005;

export type VCarveRegionPassPlan = {
  readonly passes: ReadonlyArray<CncPass>;
  readonly toleranceMet: boolean;
  readonly thinResidual: boolean;
};

export function passesForVCarveMedialRegion(
  plan: VCarveMedialRegionGeometryPlan,
  law: DetailDepthLaw,
  options: Pick<VCarveOptions, 'depthPerPassMm'>,
): VCarveRegionPassPlan {
  const passes: CncPass[] = [];
  const depthSegments = buildVCarveBoundarySegmentIndex(sourceBoundarySegments(plan.region.loops));
  let toleranceMet = true;
  let thinResidual = plan.thinResidual;
  for (let index = 0; index < plan.routes.length; index += 1) {
    const route = plan.routes[index];
    const referenceRoute = plan.referenceRoutes[index] ?? route;
    if (route === undefined || referenceRoute === undefined) continue;
    const routePlan = passesForRoute(route, referenceRoute, depthSegments, law, options);
    passes.push(...routePlan.passes);
    toleranceMet = toleranceMet && routePlan.toleranceMet;
    thinResidual = thinResidual || routePlan.passes.length === 0;
  }
  return { passes, toleranceMet, thinResidual };
}

function passesForRoute(
  route: Polyline,
  referenceRoute: Polyline,
  depthSegments: VCarveBoundarySegmentIndex,
  law: DetailDepthLaw,
  options: Pick<VCarveOptions, 'depthPerPassMm'>,
): { readonly passes: ReadonlyArray<CncPass>; readonly toleranceMet: boolean } {
  const precisionMet = vcarveRoutePrecisionMet(
    referenceRoute.points,
    depthSegments,
    law,
    MEDIAL_SWEEP_TOLERANCE_MM,
  );
  if (route.points.length === 1) {
    return {
      passes: dotPasses(route.points[0], depthSegments, law, options.depthPerPassMm),
      toleranceMet: precisionMet,
    };
  }
  const zToleranceMm = precisionMet
    ? Math.min(MEDIAL_Z_TOLERANCE_MM, MEDIAL_SWEEP_TOLERANCE_MM / law.tanHalf)
    : MEDIAL_Z_TOLERANCE_MM;
  const profile = detailPath3dPlan(route, depthSegments, law, zToleranceMm);
  const referenceProfile = detailPath3dPlan(referenceRoute, depthSegments, law, zToleranceMm);
  const candidateCovered = vcarveEmittedProfileCovers(
    referenceProfile.points,
    profile.points,
    law,
    MEDIAL_SWEEP_TOLERANCE_MM,
  );
  const selected = candidateCovered ? profile : referenceProfile;
  const passes = certifiedVCarveDepthSteppedPasses(
    selected.points,
    referenceProfile.points,
    route.closed,
    depthSegments,
    {
      depthPerPassMm: options.depthPerPassMm,
      tanHalf: law.tanHalf,
      tipRadiusMm: law.tipRadiusMm,
      outerRadiusMm: law.outerRadiusMm,
      compactionToleranceMm: MEDIAL_COMPACTION_TOLERANCE_MM,
      sweepToleranceMm: MEDIAL_SWEEP_TOLERANCE_MM,
    },
  );
  return {
    passes,
    toleranceMet: selected.toleranceMet && referenceProfile.toleranceMet && precisionMet,
  };
}

function dotPasses(
  point: Vec2 | undefined,
  depthSegments: VCarveBoundarySegmentIndex,
  law: DetailDepthLaw,
  depthPerPassMm: number,
): ReadonlyArray<CncPass> {
  if (point === undefined) return [];
  const depthMm = vcarveEmittedDepthAtPoint(point, depthSegments, law);
  if (!(depthMm > 0)) return [];
  const xyz = { x: point.x, y: point.y, z: -depthMm };
  return depthSteppedPath([xyz, xyz], false, depthPerPassMm);
}

function depthSteppedPath(
  points: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>,
  closed: boolean,
  depthPerPassMm: number,
): ReadonlyArray<CncPass> {
  let deepest = 0;
  for (const point of points) deepest = Math.min(deepest, point.z);
  if (!(deepest < 0)) return [];
  return zPassDepths(-deepest, depthPerPassMm).map((levelZ) => ({
    kind: 'path3d' as const,
    points: points.map((point) => ({ ...point, z: Math.max(point.z, levelZ) })),
    closed,
    // This is a cutting profile, not an entry ramp. Flat segments keep the
    // cutting feed; descending segments are capped by their emitted Z rate.
    lateralFeed: 'z-rate-capped' as const,
  }));
}
