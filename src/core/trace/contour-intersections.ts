import type { Polyline, Vec2 } from '../scene';
import { ContourContactCache } from './contour-contact-cache';
import { ContourOrientation } from './contour-orientation';
import { contourBox, visitContourBoxPairsSteps, type ContourBox } from './contour-spatial';
import type { TraceSteps } from './trace-steps';

type ContourEdge = ContourBox & {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly loop: number;
  readonly index: number;
  readonly count: number;
};
const EDGE_CHECKPOINT_INTERVAL = 256;

/** Loop owners of all nonadjacent crossings, contacts and collinear overlaps. */
export function* intersectingContourLoopsSteps(
  polylines: ReadonlyArray<Polyline>,
  cache = new ContourContactCache(),
): TraceSteps<Set<number>> {
  yield;
  const cached = yield* cache.findSteps(polylines);
  return cached ?? (yield* uncachedIntersectionsSteps(polylines));
}

function* uncachedIntersectionsSteps(polylines: ReadonlyArray<Polyline>): TraceSteps<Set<number>> {
  const cooperate = yield;
  const orientation = new ContourOrientation();
  const edges: ContourEdge[] = [];
  for (const [loop, polyline] of polylines.entries()) {
    if (cooperate) yield;
    const first = polyline.points[0];
    const last = polyline.points.at(-1);
    const duplicated = first !== undefined && last !== undefined && samePoint(first, last);
    const count = polyline.points.length - (duplicated ? 1 : 0);
    for (let index = 0; index < count; index += 1) {
      if (cooperate && index % EDGE_CHECKPOINT_INTERVAL === 0) yield;
      const a = polyline.points[index];
      const b = polyline.points[(index + 1) % count];
      if (a === undefined || b === undefined) continue;
      edges.push({ ...contourBox([a, b]), a, b, loop, index, count });
    }
  }
  const conflicts = new Set<number>();
  yield* visitContourBoxPairsSteps(edges, (a, b) => {
    if (adjacent(a, b)) return;
    if (!segmentsMeet(a, b, orientation)) return;
    conflicts.add(a.loop);
    conflicts.add(b.loop);
  });
  return conflicts;
}

function adjacent(a: ContourEdge, b: ContourEdge): boolean {
  const distance = Math.abs(a.index - b.index);
  return a.loop === b.loop && (distance === 1 || distance === a.count - 1);
}

// Bounding boxes already overlap. The orientation products therefore include
// endpoint contact and collinear overlap without a distance tolerance.
function segmentsMeet(a: ContourEdge, b: ContourEdge, orientation: ContourOrientation): boolean {
  return (
    orientation.sign(a.a, a.b, b.a) * orientation.sign(a.a, a.b, b.b) <= 0 &&
    orientation.sign(b.a, b.b, a.a) * orientation.sign(b.a, b.b, a.b) <= 0
  );
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}
