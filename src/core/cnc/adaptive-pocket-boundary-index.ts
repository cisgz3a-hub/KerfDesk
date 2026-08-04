import type { Polyline, Vec2 } from '../scene';

export type BoundaryEdge = readonly [Vec2, Vec2];

export type Bounds = {
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
};

export type BoundaryIndex = {
  readonly buckets: ReadonlyMap<string, ReadonlyArray<number>>;
  readonly cellMm: number;
  readonly edges: ReadonlyArray<BoundaryEdge>;
  readonly maxCol: number;
  readonly maxRow: number;
  readonly originX: number;
  readonly originY: number;
};

export function boundaryIndex(
  contours: ReadonlyArray<Polyline>,
  toolRadiusMm: number,
): BoundaryIndex | null {
  if (!positiveFinite(toolRadiusMm)) return null;
  const edges = contourEdges(contours);
  const bounds = edgeBounds(edges);
  if (edges.length === 0 || bounds === null) return null;
  const spanMm = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const cellMm = Math.max(toolRadiusMm, spanMm / 128, 0.1);
  const mutableBuckets = new Map<string, number[]>();
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex];
    if (edge === undefined) continue;
    const [start, end] = edge;
    const edgeBounds = {
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    };
    forEachCell(edgeBounds, bounds.minX, bounds.minY, cellMm, (key) => {
      const bucket = mutableBuckets.get(key);
      if (bucket === undefined) mutableBuckets.set(key, [edgeIndex]);
      else bucket.push(edgeIndex);
    });
  }
  return {
    buckets: mutableBuckets,
    cellMm,
    edges,
    maxCol: Math.floor((bounds.maxX - bounds.minX) / cellMm),
    maxRow: Math.floor((bounds.maxY - bounds.minY) / cellMm),
    originX: bounds.minX,
    originY: bounds.minY,
  };
}

export function edgesNearBounds(index: BoundaryIndex, bounds: Bounds): ReadonlyArray<BoundaryEdge> {
  const edgeIndexes = new Set<number>();
  const minCol = Math.max(0, Math.floor((bounds.minX - index.originX) / index.cellMm));
  const maxCol = Math.min(index.maxCol, Math.floor((bounds.maxX - index.originX) / index.cellMm));
  const minRow = Math.max(0, Math.floor((bounds.minY - index.originY) / index.cellMm));
  const maxRow = Math.min(index.maxRow, Math.floor((bounds.maxY - index.originY) / index.cellMm));
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      for (const edgeIndex of index.buckets.get(`${col},${row}`) ?? []) {
        edgeIndexes.add(edgeIndex);
      }
    }
  }
  const edges: BoundaryEdge[] = [];
  for (const edgeIndex of edgeIndexes) {
    const edge = index.edges[edgeIndex];
    if (edge !== undefined) edges.push(edge);
  }
  return edges;
}

function forEachCell(
  bounds: Bounds,
  originX: number,
  originY: number,
  cellMm: number,
  visit: (key: string) => void,
): void {
  const minCol = Math.floor((bounds.minX - originX) / cellMm);
  const maxCol = Math.floor((bounds.maxX - originX) / cellMm);
  const minRow = Math.floor((bounds.minY - originY) / cellMm);
  const maxRow = Math.floor((bounds.maxY - originY) / cellMm);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) visit(`${col},${row}`);
  }
}

function edgeBounds(edges: ReadonlyArray<BoundaryEdge>): Bounds | null {
  let bounds: Bounds | null = null;
  for (const [start, end] of edges) {
    for (const point of [start, end]) {
      if (!finitePoint(point)) return null;
      bounds =
        bounds === null
          ? { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }
          : {
              minX: Math.min(bounds.minX, point.x),
              minY: Math.min(bounds.minY, point.y),
              maxX: Math.max(bounds.maxX, point.x),
              maxY: Math.max(bounds.maxY, point.y),
            };
    }
  }
  return bounds;
}

function contourEdges(contours: ReadonlyArray<Polyline>): ReadonlyArray<BoundaryEdge> {
  const edges: BoundaryEdge[] = [];
  for (const contour of contours) {
    const points = withoutDuplicateClosure(contour.points);
    for (let index = 0; index < points.length; index += 1) {
      const start = points[index];
      const end = points[(index + 1) % points.length];
      if (start !== undefined && end !== undefined) edges.push([start, end]);
    }
  }
  return edges;
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function withoutDuplicateClosure(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points[points.length - 1];
  return first !== undefined && last !== undefined && first.x === last.x && first.y === last.y
    ? points.slice(0, -1)
    : points;
}
