import type { Polyline, Vec2 } from '../scene';
import { computeVCarveMedialAxis, type VCarveMedialAxisPlan } from './vcarve-medial-axis';
import { joinVCarveFloorDetours } from './vcarve-medial-detours';
import { vcarveFlatCoreRoutes } from './vcarve-medial-floor';
import {
  vcarveBoundarySegments,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';
import { vcarveMedialRoutes } from './vcarve-medial-route';
import { vcarveSourceRegionRankFromLayout, type VCarveRegionLayout } from './vcarve-region-order';
import { radialEnvelopeFootprintMm } from './radial-envelope';
import type { DetailDepthLaw } from './vcarve-detail-input';
import { vcarveTipReachability } from './vcarve-tip-reachability';

const MEDIAL_SIMPLIFY_TOLERANCE_MM = 0.003;

export type VCarveMedialRegionGeometryPlan = {
  readonly region: VCarveMedialRegion;
  readonly segments: ReadonlyArray<VCarveBoundarySegment>;
  readonly axis: VCarveMedialAxisPlan;
  readonly routes: ReadonlyArray<Polyline>;
  readonly referenceRoutes: ReadonlyArray<Polyline>;
  readonly normalizedIndex: number;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly thinResidual: boolean;
};

export type VCarveMedialRegionPlan = VCarveMedialRegionGeometryPlan & {
  readonly sourceRank: number;
};

export type UnrankedVCarveMedialRegionPlan = {
  readonly plan: VCarveMedialRegionGeometryPlan;
  readonly witness: Vec2 | undefined;
};

/** Keep an independent reference per candidate, or emit the reference set unchanged. */
export function pairVCarveMedialRoutes(
  routes: ReadonlyArray<Polyline>,
  referenceRoutes: ReadonlyArray<Polyline>,
): Pick<VCarveMedialRegionPlan, 'routes' | 'referenceRoutes'> {
  return routes.length === referenceRoutes.length
    ? { routes, referenceRoutes }
    : { routes: referenceRoutes, referenceRoutes };
}

export function planVCarveMedialRegion(
  region: VCarveMedialRegion,
  sourceLayout: VCarveRegionLayout,
  normalizedIndex: number,
  options: {
    readonly law: DetailDepthLaw;
    readonly floorPitchMm: number;
    readonly resolutionMm: number;
  },
): VCarveMedialRegionPlan {
  const unranked = planUnrankedVCarveMedialRegion(region, normalizedIndex, options);
  return {
    ...unranked.plan,
    sourceRank: vcarveSourceRegionRankFromLayout(unranked.witness, sourceLayout),
  };
}

/** Region-local work that does not need the global source-order layout. */
export function planUnrankedVCarveMedialRegion(
  region: VCarveMedialRegion,
  normalizedIndex: number,
  options: {
    readonly law: DetailDepthLaw;
    readonly floorPitchMm: number;
    readonly resolutionMm: number;
  },
): UnrankedVCarveMedialRegionPlan {
  const segments = vcarveBoundarySegments(region);
  const tipReachability = vcarveTipReachability(region.loops, options.law.tipRadiusMm);
  const radiusCapMm = radialEnvelopeFootprintMm(options.law, options.law.maxDepthMm);
  const floor = vcarveFlatCoreRoutes(region.loops, radiusCapMm, options.floorPitchMm);
  const axis = computeVCarveMedialAxis(region, options.resolutionMm);
  const medialRoutes = vcarveMedialRoutes(
    axis.graph,
    region,
    segments,
    MEDIAL_SIMPLIFY_TOLERANCE_MM,
    MEDIAL_SIMPLIFY_TOLERANCE_MM,
    radiusCapMm,
  );
  const referenceMedialRoutes = vcarveMedialRoutes(axis.graph, region, segments, 0);
  const joined = joinVCarveFloorDetours(medialRoutes, floor.routes, region, segments);
  const referenceJoined = joinVCarveFloorDetours(
    referenceMedialRoutes,
    floor.routes,
    region,
    segments,
  );
  const routes = [...joined.routes, ...joined.unlinkedFloorRoutes];
  const referenceRoutes = [...referenceJoined.routes, ...referenceJoined.unlinkedFloorRoutes];
  const pairedRoutes = pairVCarveMedialRoutes(routes, referenceRoutes);
  const witness = axis.graph.nodes[0] ?? floor.routes[0]?.points[0];
  return {
    witness,
    plan: {
      region,
      segments,
      axis,
      ...pairedRoutes,
      normalizedIndex,
      offsetFailed: floor.offsetFailed || axis.failed || tipReachability.offsetFailed,
      passLimited: floor.capped || axis.budgetLimited,
      thinResidual:
        tipReachability.residualThin || axis.graph.nodes.length === 0 || medialRoutes.length === 0,
    },
  };
}

export function orderVCarveMedialRegionPlans(
  plans: ReadonlyArray<VCarveMedialRegionPlan>,
): ReadonlyArray<VCarveMedialRegionPlan> {
  return [...plans].sort(
    (a, b) => a.sourceRank - b.sourceRank || a.normalizedIndex - b.normalizedIndex,
  );
}
