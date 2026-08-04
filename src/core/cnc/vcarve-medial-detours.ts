import type { Polyline, Vec2 } from '../scene';
import {
  distinctLoopPoints,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';
import { nearestVCarveRouteLink, type VCarveRouteLink } from './vcarve-medial-detour-link';

export type VCarveJoinedRoutes = {
  readonly routes: ReadonlyArray<Polyline>;
  readonly unlinkedFloorRoutes: ReadonlyArray<Polyline>;
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
    const link = nearestVCarveRouteLink(routes, floorPoints, region, segments);
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

function insertFloorDetour(
  route: Polyline,
  floorPoints: ReadonlyArray<Vec2>,
  link: VCarveRouteLink,
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
