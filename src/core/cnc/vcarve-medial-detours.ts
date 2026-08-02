import type { Polyline, Vec2 } from '../scene';
import {
  distinctLoopPoints,
  vcarveChordInsideRegion,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

export type VCarveJoinedRoutes = {
  readonly routes: ReadonlyArray<Polyline>;
  readonly unlinkedFloorRoutes: ReadonlyArray<Polyline>;
};

type RouteLink = {
  readonly routeIndex: number;
  readonly routePointIndex: number;
  readonly floorPointIndex: number;
  readonly distanceMm: number;
};

/**
 * Insert each closed flat-core circuit as a detour from a certified medial
 * route. The connector is cut out and back with the same boundary-distance Z
 * law, so one filled region remains one tool-down route whenever topology
 * permits it.
 */
export function joinVCarveFloorDetours(
  medialRoutes: ReadonlyArray<Polyline>,
  floorRoutes: ReadonlyArray<Polyline>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): VCarveJoinedRoutes {
  const routes: Polyline[] = medialRoutes.map((route) => ({
    ...route,
    points: [...route.points],
  }));
  const unlinkedFloorRoutes: Polyline[] = [];
  for (const floorRoute of floorRoutes) {
    const floorPoints = distinctLoopPoints(floorRoute.points);
    const link = nearestRouteLink(routes, floorPoints, region, segments);
    if (link === null) {
      unlinkedFloorRoutes.push(floorRoute);
      continue;
    }
    const route = routes[link.routeIndex];
    if (route === undefined) {
      unlinkedFloorRoutes.push(floorRoute);
      continue;
    }
    routes[link.routeIndex] = insertFloorDetour(route, floorPoints, link);
  }
  return { routes, unlinkedFloorRoutes };
}

function nearestRouteLink(
  routes: ReadonlyArray<Polyline>,
  floorPoints: ReadonlyArray<Vec2>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): RouteLink | null {
  let best: RouteLink | null = null;
  routes.forEach((route, routeIndex) => {
    route.points.forEach((routePoint, routePointIndex) => {
      floorPoints.forEach((floorPoint, floorPointIndex) => {
        const distanceMm = Math.hypot(floorPoint.x - routePoint.x, floorPoint.y - routePoint.y);
        if (best !== null && distanceMm >= best.distanceMm) return;
        if (!vcarveChordInsideRegion(routePoint, floorPoint, region, segments)) return;
        best = { routeIndex, routePointIndex, floorPointIndex, distanceMm };
      });
    });
  });
  return best;
}

function insertFloorDetour(
  route: Polyline,
  floorPoints: ReadonlyArray<Vec2>,
  link: RouteLink,
): Polyline {
  const anchor = route.points[link.routePointIndex];
  const floor = floorPoints[link.floorPointIndex];
  if (anchor === undefined || floor === undefined) return route;
  const circuit = rotatedClosedCircuit(floorPoints, link.floorPointIndex);
  const detour = samePoint(anchor, floor) ? circuit.slice(1) : [floor, ...circuit.slice(1), anchor];
  return {
    points: [
      ...route.points.slice(0, link.routePointIndex + 1),
      ...detour,
      ...route.points.slice(link.routePointIndex + 1),
    ],
    closed: route.closed,
  };
}

function rotatedClosedCircuit(
  points: ReadonlyArray<Vec2>,
  startIndex: number,
): ReadonlyArray<Vec2> {
  const rotated = [...points.slice(startIndex), ...points.slice(0, startIndex)];
  const first = rotated[0];
  return first === undefined ? [] : [...rotated, first];
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
