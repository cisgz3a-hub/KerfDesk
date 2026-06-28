import type { Polyline, Vec2 } from '../scene';

const ISLAND_MERGE_TOLERANCE_MM = 0.25;
const CENTER_ISLAND_RATIO = 0.1;
const FULL_TURN = Math.PI * 2;
const MICRO_ISLAND_MAX_DIMENSION_MM = 8;
const MICRO_ISLAND_CLUSTER_GAP_MM = 3;
const MICRO_ISLAND_CLUSTER_MAX_DIMENSION_MM = 40;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type Island = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly bounds: Bounds;
};

type IslandCluster = Island & {
  readonly microCluster: boolean;
};

type IndexedContour = {
  readonly index: number;
  readonly polyline: Polyline;
  readonly bounds: Bounds;
};

export function groupFillContoursIntoIslands(
  polylines: ReadonlyArray<Polyline>,
  options: { readonly clusterMicroIslands?: boolean } = {},
): ReadonlyArray<ReadonlyArray<Polyline>> {
  const contours = indexedContours(polylines);
  if (contours.length === 0) return [];
  const parent = contours.map((_, i) => i);
  unionConnectedContours(contours, parent);
  const islands = componentIslands(contours, parent);
  const grouped =
    options.clusterMicroIslands === true ? clusterMicroIslands(islands) : islands;
  return sortIslands(grouped).map((island) => island.polylines);
}

function indexedContours(polylines: ReadonlyArray<Polyline>): IndexedContour[] {
  const contours: IndexedContour[] = [];
  for (const polyline of polylines) {
    const bounds = polylineBounds(polyline);
    if (bounds === null) continue;
    contours.push({ index: contours.length, polyline, bounds });
  }
  return contours;
}

function unionConnectedContours(contours: ReadonlyArray<IndexedContour>, parent: number[]): void {
  const byMinX = [...contours].sort((a, b) => a.bounds.minX - b.bounds.minX);
  for (let i = 0; i < byMinX.length; i += 1) {
    const a = byMinX[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < byMinX.length; j += 1) {
      const b = byMinX[j];
      if (b === undefined) continue;
      if (b.bounds.minX > a.bounds.maxX + ISLAND_MERGE_TOLERANCE_MM) break;
      if (boundsTouchOrOverlap(a.bounds, b.bounds)) union(parent, a.index, b.index);
    }
  }
}

function componentIslands(contours: ReadonlyArray<IndexedContour>, parent: number[]): Island[] {
  const byRoot = new Map<number, IndexedContour[]>();
  for (const contour of contours) {
    const root = find(parent, contour.index);
    const list = byRoot.get(root) ?? [];
    list.push(contour);
    byRoot.set(root, list);
  }
  return [...byRoot.values()].map((component) => ({
    polylines: component.map((contour) => contour.polyline),
    bounds: unionBounds(component.map((contour) => contour.bounds)),
  }));
}

function clusterMicroIslands(islands: ReadonlyArray<Island>): Island[] {
  const clusters: IslandCluster[] = [];
  for (const island of islands) {
    if (!isMicroIsland(island)) {
      clusters.push({ ...island, microCluster: false });
      continue;
    }
    const index = clusters.findIndex((cluster) => canJoinMicroCluster(cluster, island));
    if (index === -1) {
      clusters.push({ ...island, microCluster: true });
      continue;
    }
    const cluster = clusters[index];
    if (cluster !== undefined) clusters[index] = mergeMicroCluster(cluster, island);
  }
  return clusters.map(({ microCluster: _microCluster, ...island }) => island);
}

function canJoinMicroCluster(cluster: IslandCluster, island: Island): boolean {
  if (!cluster.microCluster) return false;
  if (boundsGap(cluster.bounds, island.bounds) > MICRO_ISLAND_CLUSTER_GAP_MM) return false;
  const merged = unionBounds([cluster.bounds, island.bounds]);
  return maxDimension(merged) <= MICRO_ISLAND_CLUSTER_MAX_DIMENSION_MM;
}

function mergeMicroCluster(cluster: IslandCluster, island: Island): IslandCluster {
  return {
    microCluster: true,
    polylines: [...cluster.polylines, ...island.polylines],
    bounds: unionBounds([cluster.bounds, island.bounds]),
  };
}

function isMicroIsland(island: Island): boolean {
  return maxDimension(island.bounds) <= MICRO_ISLAND_MAX_DIMENSION_MM;
}

function sortIslands(islands: Island[]): Island[] {
  if (islands.length <= 1) return islands;
  const allBounds = unionBounds(islands.map((island) => island.bounds));
  const center = boundsCenter(allBounds);
  const centerThreshold = Math.max(
    ISLAND_MERGE_TOLERANCE_MM,
    Math.max(allBounds.maxX - allBounds.minX, allBounds.maxY - allBounds.minY) *
      CENTER_ISLAND_RATIO,
  );
  return [...islands].sort((a, b) => compareIslands(a, b, center, centerThreshold));
}

function compareIslands(a: Island, b: Island, center: Vec2, centerThreshold: number): number {
  const aCenter = boundsCenter(a.bounds);
  const bCenter = boundsCenter(b.bounds);
  const aIsCenter = distance(aCenter, center) <= centerThreshold;
  const bIsCenter = distance(bCenter, center) <= centerThreshold;
  if (aIsCenter !== bIsCenter) return aIsCenter ? 1 : -1;
  if (aIsCenter && bIsCenter) return aCenter.y - bCenter.y || aCenter.x - bCenter.x;
  return clockwiseAngleFromTop(aCenter, center) - clockwiseAngleFromTop(bCenter, center);
}

function clockwiseAngleFromTop(point: Vec2, center: Vec2): number {
  const angle = Math.atan2(point.x - center.x, center.y - point.y);
  return angle < 0 ? angle + FULL_TURN : angle;
}

function boundsTouchOrOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.minX - ISLAND_MERGE_TOLERANCE_MM <= b.maxX &&
    a.maxX + ISLAND_MERGE_TOLERANCE_MM >= b.minX &&
    a.minY - ISLAND_MERGE_TOLERANCE_MM <= b.maxY &&
    a.maxY + ISLAND_MERGE_TOLERANCE_MM >= b.minY
  );
}

function boundsGap(a: Bounds, b: Bounds): number {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

function maxDimension(bounds: Bounds): number {
  return Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function polylineBounds(polyline: Polyline): Bounds | null {
  if (polyline.points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function unionBounds(bounds: ReadonlyArray<Bounds>): Bounds {
  return {
    minX: Math.min(...bounds.map((box) => box.minX)),
    minY: Math.min(...bounds.map((box) => box.minY)),
    maxX: Math.max(...bounds.map((box) => box.maxX)),
    maxY: Math.max(...bounds.map((box) => box.maxY)),
  };
}

function boundsCenter(bounds: Bounds): Vec2 {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function find(parent: number[], x: number): number {
  const p = parent[x];
  if (p === undefined || p === x) return x;
  const root = find(parent, p);
  parent[x] = root;
  return root;
}

function union(parent: number[], a: number, b: number): void {
  const rootA = find(parent, a);
  const rootB = find(parent, b);
  if (rootA !== rootB) parent[rootB] = rootA;
}
