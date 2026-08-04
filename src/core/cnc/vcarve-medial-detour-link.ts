import type { Polyline, Vec2 } from '../scene';
import {
  vcarveChordInsideRegion,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

export type VCarveRouteLink = {
  readonly routeIndex: number;
  readonly routePointIndex: number;
  readonly floorPointIndex: number;
  readonly distanceMm: number;
};

const SPATIAL_LEAF_SIZE = 4;

type SpatialPoint = { readonly point: Vec2; readonly sourceOrder: number };

type IndexedRoutePoint = SpatialPoint & {
  readonly routeIndex: number;
  readonly routePointIndex: number;
};

type IndexedFloorPoint = SpatialPoint & { readonly floorPointIndex: number };

type PointTree<T extends SpatialPoint> = {
  readonly entries: ReadonlyArray<T> | null;
  readonly left: PointTree<T> | null;
  readonly right: PointTree<T> | null;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type RouteFloorTreePair = {
  readonly route: PointTree<IndexedRoutePoint>;
  readonly floor: PointTree<IndexedFloorPoint>;
  readonly lowerBoundMm: number;
};

/**
 * Return the former Cartesian scan's exact nearest contained pair. Route and
 * floor point trees bound unvisited pair distances; only a box pair that can
 * still beat the winner is expanded. Equal distances resolve in original
 * route-point/floor-point order, and full-chord containment stays authoritative.
 */
export function nearestVCarveRouteLink(
  routes: ReadonlyArray<Polyline>,
  floorPoints: ReadonlyArray<Vec2>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): VCarveRouteLink | null {
  const routeEntries = indexedRoutePoints(routes);
  const floorEntries = indexedFloorPoints(floorPoints);
  if (routeEntries.length === 0 || floorEntries.length === 0) return null;
  if (
    !routeEntries.every(({ point }) => finitePoint(point)) ||
    !floorEntries.every(({ point }) => finitePoint(point))
  ) {
    return nearestVCarveRouteLinkBruteForce(routes, floorPoints, region, segments);
  }
  const routeTree = buildPointTree(routeEntries);
  const floorTree = buildPointTree(floorEntries);
  return searchRouteFloorTrees(routeTree, floorTree, region, segments);
}

function indexedRoutePoints(routes: ReadonlyArray<Polyline>): IndexedRoutePoint[] {
  const entries: IndexedRoutePoint[] = [];
  routes.forEach((route, routeIndex) => {
    route.points.forEach((point, routePointIndex) => {
      entries.push({ point, routeIndex, routePointIndex, sourceOrder: entries.length });
    });
  });
  return entries;
}

function indexedFloorPoints(floorPoints: ReadonlyArray<Vec2>): IndexedFloorPoint[] {
  return floorPoints.map((point, floorPointIndex) => ({
    point,
    floorPointIndex,
    sourceOrder: floorPointIndex,
  }));
}

function buildPointTree<T extends SpatialPoint>(entries: ReadonlyArray<T>): PointTree<T> {
  const bounds = pointBounds(entries);
  if (entries.length <= SPATIAL_LEAF_SIZE) {
    return {
      entries: [...entries].sort((a, b) => a.sourceOrder - b.sourceOrder),
      left: null,
      right: null,
      ...bounds,
    };
  }
  const axis = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY ? 'x' : 'y';
  const ordered = [...entries].sort((a, b) => compareSpatialPoints(a, b, axis));
  const middle = Math.floor(ordered.length / 2);
  const left = buildPointTree(ordered.slice(0, middle));
  const right = buildPointTree(ordered.slice(middle));
  return { entries: null, left, right, ...bounds };
}

function searchRouteFloorTrees(
  routeTree: PointTree<IndexedRoutePoint>,
  floorTree: PointTree<IndexedFloorPoint>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): VCarveRouteLink | null {
  let best: VCarveRouteLink | null = null;
  const pending: RouteFloorTreePair[] = [];
  pushTreePair(pending, routeTree, floorTree);
  while (pending.length > 0) {
    const pair = popTreePair(pending);
    if (pair === null) break;
    if (best !== null && pair.lowerBoundMm > best.distanceMm) break;
    if (pair.route.entries !== null && pair.floor.entries !== null) {
      best = searchLeafPair(pair, region, segments, best);
      continue;
    }
    if (splitRouteTreeFirst(pair.route, pair.floor)) {
      for (const child of [pair.route.left, pair.route.right]) {
        if (child !== null) pushTreePair(pending, child, pair.floor);
      }
    } else {
      for (const child of [pair.floor.left, pair.floor.right]) {
        if (child !== null) pushTreePair(pending, pair.route, child);
      }
    }
  }
  return best;
}

function searchLeafPair(
  pair: RouteFloorTreePair,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  initialBest: VCarveRouteLink | null,
): VCarveRouteLink | null {
  let best = initialBest;
  for (const routePoint of pair.route.entries ?? []) {
    for (const floorPoint of pair.floor.entries ?? []) {
      const distanceMm = Math.hypot(
        floorPoint.point.x - routePoint.point.x,
        floorPoint.point.y - routePoint.point.y,
      );
      if (!linkCanBeatBest(routePoint, floorPoint.floorPointIndex, distanceMm, best)) continue;
      if (!vcarveChordInsideRegion(routePoint.point, floorPoint.point, region, segments)) continue;
      best = {
        routeIndex: routePoint.routeIndex,
        routePointIndex: routePoint.routePointIndex,
        floorPointIndex: floorPoint.floorPointIndex,
        distanceMm,
      };
    }
  }
  return best;
}

function splitRouteTreeFirst(
  route: PointTree<IndexedRoutePoint>,
  floor: PointTree<IndexedFloorPoint>,
): boolean {
  if (route.entries !== null) return false;
  if (floor.entries !== null) return true;
  const routeSpan = Math.max(route.maxX - route.minX, route.maxY - route.minY);
  const floorSpan = Math.max(floor.maxX - floor.minX, floor.maxY - floor.minY);
  return routeSpan >= floorSpan;
}

function pushTreePair(
  heap: RouteFloorTreePair[],
  route: PointTree<IndexedRoutePoint>,
  floor: PointTree<IndexedFloorPoint>,
): void {
  const pair = { route, floor, lowerBoundMm: treePairDistance(route, floor) };
  heap.push(pair);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    const parentPair = heap[parent];
    if (parentPair === undefined || compareTreePairs(parentPair, pair) <= 0) break;
    heap[index] = parentPair;
    index = parent;
  }
  heap[index] = pair;
}

function popTreePair(heap: RouteFloorTreePair[]): RouteFloorTreePair | null {
  const first = heap[0];
  const last = heap.pop();
  if (first === undefined || last === undefined) return null;
  if (heap.length === 0) return first;
  let index = 0;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    const left = heap[leftIndex];
    const right = heap[rightIndex];
    if (left === undefined) break;
    const childIndex =
      right !== undefined && compareTreePairs(right, left) < 0 ? rightIndex : leftIndex;
    const child = heap[childIndex];
    if (child === undefined || compareTreePairs(last, child) <= 0) break;
    heap[index] = child;
    index = childIndex;
  }
  heap[index] = last;
  return first;
}

function compareTreePairs(a: RouteFloorTreePair, b: RouteFloorTreePair): number {
  return a.lowerBoundMm - b.lowerBoundMm;
}

function treePairDistance(a: PointTree<SpatialPoint>, b: PointTree<SpatialPoint>): number {
  const dx = a.maxX < b.minX ? b.minX - a.maxX : b.maxX < a.minX ? a.minX - b.maxX : 0;
  const dy = a.maxY < b.minY ? b.minY - a.maxY : b.maxY < a.minY ? a.minY - b.maxY : 0;
  return Math.hypot(dx, dy);
}

function linkCanBeatBest(
  routePoint: IndexedRoutePoint,
  floorPointIndex: number,
  distanceMm: number,
  best: VCarveRouteLink | null,
): boolean {
  if (best === null || distanceMm < best.distanceMm) return true;
  if (distanceMm > best.distanceMm) return false;
  return (
    routePoint.routeIndex < best.routeIndex ||
    (routePoint.routeIndex === best.routeIndex &&
      (routePoint.routePointIndex < best.routePointIndex ||
        (routePoint.routePointIndex === best.routePointIndex &&
          floorPointIndex < best.floorPointIndex)))
  );
}

function pointBounds(entries: ReadonlyArray<SpatialPoint>) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { point } of entries) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function compareSpatialPoints(a: SpatialPoint, b: SpatialPoint, axis: 'x' | 'y'): number {
  return axis === 'x'
    ? a.point.x - b.point.x || a.point.y - b.point.y || a.sourceOrder - b.sourceOrder
    : a.point.y - b.point.y || a.point.x - b.point.x || a.sourceOrder - b.sourceOrder;
}

function nearestVCarveRouteLinkBruteForce(
  routes: ReadonlyArray<Polyline>,
  floorPoints: ReadonlyArray<Vec2>,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): VCarveRouteLink | null {
  let best: VCarveRouteLink | null = null;
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

const finitePoint = (point: Vec2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);
