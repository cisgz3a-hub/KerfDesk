import type { Vec2 } from '../scene';
import { contourBox, finiteContourBox, type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import { contourEdgesSteps, type ContourEdges } from './contour-edges';
import { ContourOrientation, insideContour } from './contour-orientation';
import { runTraceSteps, type TraceSteps } from './trace-steps';

type CrossingEdge = ContourBox & { readonly a: Vec2; readonly b: Vec2 };
type MembershipResult = { readonly x: number; readonly y: number; readonly inside: boolean };
type PreparedContour = {
  readonly bounds: ContourBox;
  readonly membership: WeakMap<Vec2, MembershipResult>;
  index?: ContourBoxIndex<CrossingEdge>;
  scanned: boolean;
};

// Many boundaries answer a single membership query. The first query scans
// the edges, which is no more work than building the index; a second query
// builds the index, so later queries never scan every edge.
const SCAN_CHECKPOINT_INTERVAL = 32;

/** Edges already indexed for a boundary elsewhere, if any. */
export type IndexedContourEdges = (points: ReadonlyArray<Vec2>) => ContourEdges | null | undefined;

/** Reuse immutable source/candidate boundaries during one topology repair. */
export class ContourMembership {
  private readonly prepared = new WeakMap<ReadonlyArray<Vec2>, PreparedContour | null>();
  private readonly orientation = new ContourOrientation();

  /** `indexed` lends boundaries whose edges are already indexed, such as the
   *  contact cache's (contour-contact-cache.ts); their index answers the ray. */
  constructor(private readonly indexed?: IndexedContourEdges) {}

  contains(point: Vec2, points: ReadonlyArray<Vec2>): boolean {
    return runTraceSteps(this.containsSteps(point, points));
  }

  *containsSteps(point: Vec2, points: ReadonlyArray<Vec2>): TraceSteps<boolean> {
    yield;
    let contour = this.prepared.get(points);
    if (contour === undefined) {
      const bounds = contourBox(points);
      contour = finiteContourBox(bounds)
        ? { bounds, membership: new WeakMap(), scanned: false }
        : null;
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
    // Refinement revisits the same source/candidate relationships. Cache only
    // queries that need a ray scan; cheap bounding rejects need no retained entry.
    const previous = contour.membership.get(point);
    if (matchesQuery(previous, point)) return previous.inside;
    const inside = (yield* this.windingSteps(point, points, contour)) !== 0;
    contour.membership.set(point, { x: point.x, y: point.y, inside });
    return inside;
  }

  private *windingSteps(
    point: Vec2,
    points: ReadonlyArray<Vec2>,
    contour: PreparedContour,
  ): TraceSteps<number> {
    // A lent index answers from the first query; otherwise the first query
    // scans and a second builds the crossing index.
    if (contour.index === undefined) {
      const lent = this.indexed?.(points)?.index;
      if (lent !== undefined) contour.index = lent;
    }
    if (contour.scanned || contour.index !== undefined) {
      contour.index ??= yield* crossingIndexSteps(points);
      return rayWinding(point, contour.index, this.orientation);
    }
    const winding = yield* scannedWindingSteps(point, points, this.orientation);
    contour.scanned = true;
    return winding;
  }
}

function matchesQuery(
  previous: MembershipResult | undefined,
  point: Vec2,
): previous is MembershipResult {
  return previous !== undefined && previous.x === point.x && previous.y === point.y;
}

/** Every edge of the boundary may be in the index: a horizontal edge never
 *  crosses the ray, and a repeated closing point adds only a horizontal edge,
 *  so an index of all edges (contour-edges.ts) gives the same winding. */
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
  for (const { a, b } of index.query(ray)) winding += crossing(a, b, point, orientation);
  return winding;
}

function crossing(a: Vec2, b: Vec2, point: Vec2, orientation: ContourOrientation): number {
  if (a.y <= point.y && b.y > point.y && orientation.sign(a, b, point) > 0) return 1;
  if (a.y > point.y && b.y <= point.y && orientation.sign(a, b, point) < 0) return -1;
  return 0;
}

/** rayWinding without the index: the same edges, those whose inclusive box
 *  meets the rightward ray, and the winding is a sum, so it is the same. */
function* scannedWindingSteps(
  point: Vec2,
  points: ReadonlyArray<Vec2>,
  orientation: ContourOrientation,
): TraceSteps<number> {
  const cooperate = yield;
  let winding = 0;
  for (let i = 0; i < points.length; i += 1) {
    if (cooperate && i % SCAN_CHECKPOINT_INTERVAL === 0) yield;
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined || a.y === b.y) continue;
    if (Math.max(a.x, b.x) < point.x) continue;
    if (Math.min(a.y, b.y) > point.y || Math.max(a.y, b.y) < point.y) continue;
    winding += crossing(a, b, point, orientation);
  }
  return winding;
}

// The boundary's own edge index (contour-edges.ts), which makes its edges on
// demand: every edge is in it, which gives the same winding (rayWinding).
function* crossingIndexSteps(
  points: ReadonlyArray<Vec2>,
): TraceSteps<ContourBoxIndex<CrossingEdge>> {
  const edges = yield* contourEdgesSteps(points);
  return edges?.index ?? (yield* ContourBoxIndex.createSteps<CrossingEdge>([]));
}
