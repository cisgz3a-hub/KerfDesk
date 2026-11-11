import type { Polyline, Vec2 } from '../scene';
import { runTraceSteps, type TraceSteps } from '../trace/trace-steps';

const LEAF_SIZE = 8;

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
export type ContactSegment = Bounds & {
  readonly owner: number;
  readonly from: number;
  readonly to: number;
  readonly start: Vec2;
  readonly end: Vec2;
};
export type ContactIndex = Bounds &
  (
    | { readonly segments: ReadonlyArray<ContactSegment> }
    | { readonly left: ContactIndex; readonly right: ContactIndex }
  );

/** A balanced bounding-box index; no grid size, geometry cap or distance policy. */
export function polylineContactIndex(polylines: ReadonlyArray<Polyline>): ContactIndex | null {
  return runTraceSteps(polylineContactIndexSteps(polylines));
}

/** polylineContactIndex as resumable steps: a checkpoint after each polyline's
 *  segments and each index node. */
export function* polylineContactIndexSteps(
  polylines: ReadonlyArray<Polyline>,
): TraceSteps<ContactIndex | null> {
  const cooperate = yield;
  const segments: KeyedSegment[] = [];
  for (const [owner, polyline] of polylines.entries()) {
    for (const segment of polylineSegments(polyline, owner)) segments.push(keyed(segment));
    if (cooperate) yield;
  }
  if (segments.length === 0) return null;
  return yield* buildIndex(segments, cooperate);
}

function polylineSegments(polyline: Polyline, owner: number): ContactSegment[] {
  const count = contactPointCount(polyline);
  const edges = polyline.closed ? count : Math.max(0, count - 1);
  return Array.from({ length: edges }, (_, from) => {
    const to = (from + 1) % count;
    const start = polyline.points[from] as Vec2,
      end = polyline.points[to] as Vec2;
    return {
      owner,
      from,
      to,
      start,
      end,
      minX: Math.min(start.x, end.x),
      minY: Math.min(start.y, end.y),
      maxX: Math.max(start.x, end.x),
      maxY: Math.max(start.y, end.y),
    };
  }).filter((s) => [s.minX, s.minY, s.maxX, s.maxY].every(Number.isFinite));
}

// A segment with the centre each split sorts it by, computed once rather than
// in every comparison. Same expression, so the same comparisons: the stable
// sort orders segments, and so builds the tree, exactly as before.
type KeyedSegment = {
  readonly segment: ContactSegment;
  readonly centreX: number;
  readonly centreY: number;
};

function keyed(segment: ContactSegment): KeyedSegment {
  return {
    segment,
    centreX: segment.minX / 2 + segment.maxX / 2,
    centreY: segment.minY / 2 + segment.maxY / 2,
  };
}

export function contactPointCount(polyline: Polyline): number {
  const first = polyline.points[0],
    last = polyline.points.at(-1);
  return polyline.closed &&
    polyline.points.length > 1 &&
    first?.x === last?.x &&
    first?.y === last?.y
    ? polyline.points.length - 1
    : polyline.points.length;
}

export function visitContactCandidates(
  point: Vec2,
  index: ContactIndex | null,
  visit: (segment: ContactSegment) => void,
): void {
  if (index === null || !containsPoint(index, point)) return;
  if ('segments' in index) {
    for (const segment of index.segments) if (containsPoint(segment, point)) visit(segment);
  } else {
    visitContactCandidates(point, index.left, visit);
    visitContactCandidates(point, index.right, visit);
  }
}

function containsPoint(bounds: Bounds, point: Vec2): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

function* buildIndex(
  entries: ReadonlyArray<KeyedSegment>,
  cooperate: boolean,
): TraceSteps<ContactIndex> {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const { segment } of entries) {
    minX = Math.min(minX, segment.minX);
    minY = Math.min(minY, segment.minY);
    maxX = Math.max(maxX, segment.maxX);
    maxY = Math.max(maxY, segment.maxY);
  }
  const bounds = { minX, minY, maxX, maxY };
  if (entries.length <= LEAF_SIZE) return { ...bounds, segments: entries.map((e) => e.segment) };
  const isX = maxX - minX >= maxY - minY;
  const sorted = [...entries].sort((a, b) => (isX ? a.centreX - b.centreX : a.centreY - b.centreY));
  if (cooperate) yield;
  const middle = Math.floor(sorted.length / 2);
  return {
    ...bounds,
    left: yield* buildIndex(sorted.slice(0, middle), cooperate),
    right: yield* buildIndex(sorted.slice(middle), cooperate),
  };
}
