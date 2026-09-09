import type { Vec2 } from '../scene';
import { finiteContourBox, unionContourBoxes, type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import type { TraceSteps } from './trace-steps';

export type ContourEdge = ContourBox & {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly index: number;
  readonly count: number;
};
export type ContourEdges = ContourBox & {
  readonly edges: ReadonlyArray<ContourEdge>;
  readonly index: ContourBoxIndex<ContourEdge>;
};

/** Prepare one immutable boundary, retaining the original implicit closure. */
export function* contourEdgesSteps(points: ReadonlyArray<Vec2>): TraceSteps<ContourEdges | null> {
  const cooperate = yield;
  const first = points[0],
    last = points.at(-1);
  const duplicated =
    first !== undefined && last !== undefined && first.x === last.x && first.y === last.y;
  const count = points.length - (duplicated ? 1 : 0);
  const edges: ContourEdge[] = [];
  for (let i = 0; i < count; i += 1) {
    if (cooperate && i % 256 === 0) yield;
    const a = points[i],
      b = points[(i + 1) % count];
    if (a === undefined || b === undefined) continue;
    edges.push({
      minX: Math.min(a.x, b.x),
      minY: Math.min(a.y, b.y),
      maxX: Math.max(a.x, b.x),
      maxY: Math.max(a.y, b.y),
      a,
      b,
      index: i,
      count,
    });
  }
  const bounds = unionContourBoxes(edges);
  if (!finiteContourBox(bounds)) return null;
  return { ...bounds, edges, index: yield* ContourBoxIndex.createSteps(edges) };
}

export function adjacentContourEdges(a: ContourEdge, b: ContourEdge): boolean {
  const distance = Math.abs(a.index - b.index);
  return distance === 1 || distance === a.count - 1;
}
