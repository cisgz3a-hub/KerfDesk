import type { Vec2 } from '../scene';
import { finiteContourBox, type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import type { TraceSteps } from './trace-steps';

export type ContourEdge = ContourBox & {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly index: number;
  readonly count: number;
};
export type ContourEdges = ContourBox & {
  readonly points: ReadonlyArray<Vec2>;
  /** Edges; edge `i` runs from `points[i]` to the next point, wrapping. */
  readonly count: number;
  readonly index: ContourBoxIndex<ContourEdge>;
};

// Edges are made on demand, never kept: the topology repair keeps an index
// for every ring it has seen, and one object per sample was a large share of
// its heap. The index keeps each edge's box, Math.min and Math.max of its two
// ends, the same box the edge's getters give.
class Edge implements ContourEdge {
  constructor(
    readonly a: Vec2,
    readonly b: Vec2,
    readonly index: number,
    readonly count: number,
  ) {}
  get minX(): number {
    return Math.min(this.a.x, this.b.x);
  }
  get minY(): number {
    return Math.min(this.a.y, this.b.y);
  }
  get maxX(): number {
    return Math.max(this.a.x, this.b.x);
  }
  get maxY(): number {
    return Math.max(this.a.y, this.b.y);
  }
}

/** Edge `i` of a boundary with `count` edges. */
export function contourEdge(points: ReadonlyArray<Vec2>, i: number, count: number): ContourEdge {
  return new Edge(points[i] as Vec2, points[i + 1 === count ? 0 : i + 1] as Vec2, i, count);
}

/** Prepare one immutable boundary, retaining the original implicit closure. */
export function* contourEdgesSteps(points: ReadonlyArray<Vec2>): TraceSteps<ContourEdges | null> {
  const cooperate = yield;
  const first = points[0],
    last = points.at(-1);
  const duplicated =
    first !== undefined && last !== undefined && first.x === last.x && first.y === last.y;
  const count = points.length - (duplicated ? 1 : 0);
  const bounds = new Float64Array(4 * count);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < count; i += 1) {
    if (cooperate && i % 256 === 0) yield;
    const a = points[i] as Vec2,
      b = points[i + 1 === count ? 0 : i + 1] as Vec2;
    const at = 4 * i;
    const edgeMinX = Math.min(a.x, b.x),
      edgeMinY = Math.min(a.y, b.y),
      edgeMaxX = Math.max(a.x, b.x),
      edgeMaxY = Math.max(a.y, b.y);
    bounds[at] = edgeMinX;
    bounds[at + 1] = edgeMinY;
    bounds[at + 2] = edgeMaxX;
    bounds[at + 3] = edgeMaxY;
    minX = Math.min(minX, edgeMinX);
    minY = Math.min(minY, edgeMinY);
    maxX = Math.max(maxX, edgeMaxX);
    maxY = Math.max(maxY, edgeMaxY);
  }
  const box = { minX, minY, maxX, maxY };
  if (!finiteContourBox(box)) return null;
  const index = yield* ContourBoxIndex.overBoundsSteps(bounds, (i) =>
    contourEdge(points, i, count),
  );
  return { ...box, points, count, index };
}

/** Edges `i` and `j` of a boundary with `count` edges share an end. */
export function adjacentContourEdgeIndices(i: number, j: number, count: number): boolean {
  const distance = Math.abs(i - j);
  return distance === 1 || distance === count - 1;
}
