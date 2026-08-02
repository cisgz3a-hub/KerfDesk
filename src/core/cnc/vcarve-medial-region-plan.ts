import type { Polyline } from '../scene';
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

const MEDIAL_SIMPLIFY_TOLERANCE_MM = 0.003;

export type VCarveMedialRegionPlan = {
  readonly region: VCarveMedialRegion;
  readonly segments: ReadonlyArray<VCarveBoundarySegment>;
  readonly axis: VCarveMedialAxisPlan;
  readonly routes: ReadonlyArray<Polyline>;
  readonly referenceRoutes: ReadonlyArray<Polyline>;
  readonly sourceRank: number;
  readonly normalizedIndex: number;
  readonly offsetFailed: boolean;
  readonly passLimited: boolean;
  readonly thinResidual: boolean;
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
    readonly maxDepthMm: number;
    readonly tanHalf: number;
    readonly floorPitchMm: number;
    readonly resolutionMm: number;
  },
): VCarveMedialRegionPlan {
  const segments = vcarveBoundarySegments(region);
  const floor = vcarveFlatCoreRoutes(
    region.loops,
    options.maxDepthMm * options.tanHalf,
    options.floorPitchMm,
  );
  const axis = computeVCarveMedialAxis(region, options.resolutionMm);
  const medialRoutes = vcarveMedialRoutes(
    axis.graph,
    region,
    segments,
    MEDIAL_SIMPLIFY_TOLERANCE_MM,
    MEDIAL_SIMPLIFY_TOLERANCE_MM,
    options.maxDepthMm * options.tanHalf,
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
    region,
    segments,
    axis,
    ...pairedRoutes,
    sourceRank: vcarveSourceRegionRankFromLayout(witness, sourceLayout),
    normalizedIndex,
    offsetFailed: floor.offsetFailed || axis.failed,
    passLimited: floor.capped || axis.budgetLimited,
    thinResidual: axis.graph.nodes.length === 0 || medialRoutes.length === 0,
  };
}

export function orderVCarveMedialRegionPlans(
  plans: ReadonlyArray<VCarveMedialRegionPlan>,
): ReadonlyArray<VCarveMedialRegionPlan> {
  return [...plans].sort(
    (a, b) => a.sourceRank - b.sourceRank || a.normalizedIndex - b.normalizedIndex,
  );
}
