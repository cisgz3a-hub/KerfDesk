// Which sources an inward offset left without a ring of their own (ADR-410
// Amendment 6). The selection is offset as one design, so the result does not
// say which source made which ring. A source whose closed outline has no
// inward ring within the offset distance made none: it was too small or too
// thin and collapsed, or it is an open line, which has no inside. With Delete
// original objects such a source leaves the burn with no replacement (tools
// audit T1, T33-P2-2), so the dialog and the action name it.

import { isClosedEnough, type ImportedSvg, type Vec2 as Point } from '../scene';
import { OFFSET_SOURCE_CURVE_TOLERANCE_MM } from './offset-arc-tolerance';
import {
  isClosedPolygon,
  materializeVectorObjectWithin,
  tryVectorOp,
  type VectorSceneObject,
} from './vector-path-tools';

type Ring = { readonly points: ReadonlyArray<Point>; readonly box: Box };
type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

// A ring of the source's own sits at the distance, within the arc and curve
// tolerances. A shape farther than this from every ring made none; one closer
// than this to another shape's ring merged with it and is counted as covered.
const REACH_SLACK_MM = 0.05;
const REACH_SLACK_FRACTION = 0.01;

/** The sources, in order, that have no part of `inward` of their own. */
export function sourcesWithoutInwardOffset(
  sources: ReadonlyArray<VectorSceneObject>,
  inward: ImportedSvg | null,
  distanceMm: number,
): ReadonlyArray<VectorSceneObject> {
  const reach = distanceMm * (1 + REACH_SLACK_FRACTION) + REACH_SLACK_MM;
  const result = inward === null ? [] : rings(inward.paths.flatMap((path) => path.polylines));
  return sources.filter((source) => {
    const materialized = tryVectorOp(() =>
      materializeVectorObjectWithin(source, OFFSET_SOURCE_CURVE_TOLERANCE_MM),
    );
    // A source the offset could not read is not reported as lost.
    if (materialized.kind === 'error') return false;
    const own = rings(
      materialized.value.paths
        .flatMap((path) => path.polylines)
        .filter((polyline) => isClosedPolygon(polyline) || isClosedEnough(polyline)),
    );
    return !own.some((ring) => result.some((other) => ringsWithin(ring, other, reach)));
  });
}

function rings(polylines: ReadonlyArray<{ readonly points: ReadonlyArray<Point> }>): Ring[] {
  return polylines
    .filter((polyline) => polyline.points.length >= 2)
    .map((polyline) => ({ points: polyline.points, box: boxOf(polyline.points) }));
}

function boxOf(points: ReadonlyArray<Point>): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function ringsWithin(a: Ring, b: Ring, reach: number): boolean {
  if (
    a.box.minX - reach > b.box.maxX ||
    b.box.minX - reach > a.box.maxX ||
    a.box.minY - reach > b.box.maxY ||
    b.box.minY - reach > a.box.maxY
  )
    return false;
  const reachSq = reach * reach;
  return vertexNear(a.points, b.points, reachSq) || vertexNear(b.points, a.points, reachSq);
}

// True when a vertex of `from` lies within reach of a closed ring's edge in `to`.
function vertexNear(
  from: ReadonlyArray<Point>,
  to: ReadonlyArray<Point>,
  reachSq: number,
): boolean {
  for (const point of from) {
    let start = to[to.length - 1];
    for (const end of to) {
      if (start !== undefined && segmentDistanceSq(point, start, end) <= reachSq) return true;
      start = end;
    }
  }
  return false;
}

function segmentDistanceSq(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq));
  const x = start.x + t * dx - point.x;
  const y = start.y + t * dy - point.y;
  return x * x + y * y;
}
