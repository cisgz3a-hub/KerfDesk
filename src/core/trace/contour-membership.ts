import type { Vec2 } from '../scene';
import { contourBox, finiteContourBox, type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import { ContourOrientation, insideContour } from './contour-orientation';
import { runTraceSteps, type TraceSteps } from './trace-steps';

type CrossingEdge = ContourBox & { readonly a: Vec2; readonly b: Vec2 };
type PreparedContour = {
  readonly bounds: ContourBox;
  index?: ContourBoxIndex<CrossingEdge>;
};

/** Reuse immutable source/candidate boundaries during one topology repair. */
export class ContourMembership {
  private readonly prepared = new WeakMap<ReadonlyArray<Vec2>, PreparedContour | null>();
  private readonly orientation = new ContourOrientation();

  contains(point: Vec2, points: ReadonlyArray<Vec2>): boolean {
    return runTraceSteps(this.containsSteps(point, points));
  }

  *containsSteps(point: Vec2, points: ReadonlyArray<Vec2>): TraceSteps<boolean> {
    yield;
    let contour = this.prepared.get(points);
    if (contour === undefined) {
      const bounds = contourBox(points);
      contour = finiteContourBox(bounds) ? { bounds } : null;
      this.prepared.set(points, contour);
    }
    if (contour === null || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return insideContour(point, points);
    }
    const { bounds } = contour;
    if (
      point.x < bounds.minX ||
      point.x > bounds.maxX ||
      point.y < bounds.minY ||
      point.y > bounds.maxY
    )
      return false;
    contour.index ??= yield* crossingIndexSteps(points);
    return rayWinding(point, contour.index, this.orientation) !== 0;
  }
}

function rayWinding(
  point: Vec2,
  index: ContourBoxIndex<CrossingEdge>,
  orientation: ContourOrientation,
): number {
  let winding = 0;
  // Only edges intersecting the rightward horizontal ray can contribute.
  // Inclusive boxes retain vertices; the original half-open y test below
  // still counts a shared vertex once and keeps exact boundary behavior.
  const ray = { minX: point.x, maxX: Infinity, minY: point.y, maxY: point.y };
  for (const { a, b } of index.query(ray)) {
    if (a.y <= point.y && b.y > point.y && orientation.sign(a, b, point) > 0) winding += 1;
    if (a.y > point.y && b.y <= point.y && orientation.sign(a, b, point) < 0) winding -= 1;
  }
  return winding;
}

function* crossingIndexSteps(
  points: ReadonlyArray<Vec2>,
): TraceSteps<ContourBoxIndex<CrossingEdge>> {
  const cooperate = yield;
  const edges: CrossingEdge[] = [];
  for (let i = 0; i < points.length; i += 1) {
    if (cooperate && i % 256 === 0) yield;
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined || a.y === b.y) continue;
    edges.push({ ...contourBox([a, b]), a, b });
  }
  return yield* ContourBoxIndex.createSteps(edges);
}
