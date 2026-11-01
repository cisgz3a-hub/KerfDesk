// Segment ordering primitives for the path optimizer. Keeping this focused
// module separate lets optimize-paths own group orchestration only.

import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import {
  closedStartCandidates,
  nearestClosedStart,
  type ClosedShapeStart,
} from './closed-shape-start';
import { containmentDepths } from './containment-depth';
import { reverseCutSegment, rotateClosedCutSegment } from './cut-arc-moves';
import {
  insideFirstHolds,
  releaseHolds,
  waitingCounts,
  type InsideFirstHolds,
} from './inside-first-holds';
import type { CutSegment } from './job';
import { refineRoute } from './route-refine';
import { polylineBounds, type SegmentBounds } from './segment-bounds';
import { createNearestEntryQuery, type SegmentEntry } from './segment-entry-index';

const ORIGIN: Vec2 = { x: 0, y: 0 };

// closedShapeStart is optional here: absent means 'drawn', today's behaviour.
export type SegmentOrderSettings = Pick<
  ProjectOptimizationSettings,
  'insideFirst' | 'pathDirection' | 'startPoint'
> &
  Partial<Pick<ProjectOptimizationSettings, 'closedShapeStart'>>;

export type EntryPolicy = {
  readonly allowsReverse: boolean;
  readonly closedShapeStart: ClosedShapeStart;
};

/** ADR-669: improve the nearest-neighbour route, scoring the hop to `returnTo`
 * (the park) when given, and keeping the first segment first when pinned. */
export type SegmentRouteRefinement = {
  readonly returnTo: Vec2 | null;
  readonly pinFirst: boolean;
};

export function configuredSegmentOrder<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  settings: SegmentOrderSettings,
  initialCursor?: Vec2,
  refinement?: SegmentRouteRefinement,
): T[] {
  const startCursor = initialCursor ?? startCursorForSegments(segments, settings.startPoint);
  const policy: EntryPolicy = {
    allowsReverse: settings.pathDirection === 'allow-reverse',
    closedShapeStart: settings.closedShapeStart ?? 'drawn',
  };
  const holds = settings.insideFirst ? segmentHolds(segments) : undefined;
  const route = nearestNeighborOrderFrom(segments, startCursor, policy, holds);
  // A segment that never received a usable entry can leave an outline held
  // for ever; depth-major order cannot stall, so it takes over then.
  if (route.stalled) return depthMajorNearestNeighborOrder(segments, startCursor, policy);
  if (refinement === undefined) return route.segments;
  // Refine from the given order when it already keeps inside-first and is
  // shorter: planning a planned route then returns it, and a route is never
  // made longer than the order it came in.
  const base = givenOrderIsBetter(segments, route, startCursor, refinement, holds)
    ? { segments: [...segments], indices: segments.map((_, index) => index) }
    : route;
  return refinedSegmentRoute(base, startCursor, policy, refinement, holds);
}

function givenOrderIsBetter<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  route: NearestNeighbourRoute<T>,
  start: Vec2,
  refinement: SegmentRouteRefinement,
  holds: InsideFirstHolds | undefined,
): boolean {
  if (refinement.pinFirst || route.segments.length !== segments.length) return false;
  if (holds?.any === true && holds.holds.some((list, index) => list.some((held) => held < index)))
    return false;
  // Strictly shorter: on a tie the nearest-neighbour route stands, as before.
  const given = routeCost(segments, start, refinement.returnTo);
  return given < routeCost(route.segments, start, refinement.returnTo);
}

// Travel from `start` through every segment, then to `returnTo`. NaN when a
// segment has no point, which never compares as better.
function routeCost(
  segments: ReadonlyArray<CutSegment>,
  start: Vec2,
  returnTo: Vec2 | null,
): number {
  let total = 0;
  let cursor: Vec2 = start;
  for (const segment of segments) {
    const first = segment.polyline[0];
    const last = segment.polyline[segment.polyline.length - 1];
    if (first === undefined || last === undefined) return Number.NaN;
    total += span(cursor, first);
    cursor = last;
  }
  return returnTo === null ? total : total + span(cursor, returnTo);
}

function span(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Inside-first holds (ADR-669) among one group's segments. A closed segment
 * encloses its own bounds. Tabs and perforation cut a contour into open
 * pieces that carry its nesting (ADR-531); each piece holds as the whole
 * contour, the bounds of every piece with the same contour identity, so a
 * hole still goes before every piece of its outline. Any other open path
 * encloses nothing.
 */
export function segmentHolds(segments: ReadonlyArray<CutSegment>): InsideFirstHolds {
  const depths = containmentDepths(segments);
  const bounds = segments.map((segment) => polylineBounds(segment.polyline));
  const keys = segments.map(contourKey);
  const contours = new Map<string, SegmentBounds>();
  keys.forEach((key, index) => {
    const box = bounds[index];
    if (key === null || box === null || box === undefined) return;
    const known = contours.get(key);
    contours.set(key, known === undefined ? box : unionBox(known, box));
  });
  return insideFirstHolds(
    segments.map((segment, index) => {
      const key = keys[index];
      const own = bounds[index] ?? null;
      return {
        depth: depths[index] ?? 0,
        container:
          key !== null && key !== undefined
            ? (contours.get(key) ?? null)
            : segment.closed
              ? own
              : null,
        members: [own],
      };
    }),
  );
}

// The contour a piece was cut from: its compiled identity, or for historical
// pieces without one, every piece of its forest at its depth (wider, which
// only ever delays an outline).
function contourKey(segment: CutSegment): string | null {
  const nesting = segment.nesting;
  if (nesting === undefined) return null;
  if (nesting.topologyContour !== undefined)
    return `contour\u0000${nesting.forest}\u0000${nesting.topologyContour}`;
  return segment.closed ? null : `forest\u0000${nesting.forest}\u0000${nesting.depth}`;
}

function unionBox(a: SegmentBounds, b: SegmentBounds): SegmentBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function refinedSegmentRoute<T extends CutSegment>(
  route: Pick<NearestNeighbourRoute<T>, 'segments' | 'indices'>,
  start: Vec2,
  policy: EntryPolicy,
  refinement: SegmentRouteRefinement,
  holds: InsideFirstHolds | undefined,
): T[] {
  const { segments, indices } = route;
  const refined = refineRoute(
    segments.map((segment) => ({
      entry: segment.polyline[0] as Vec2,
      exit: segment.polyline[segment.polyline.length - 1] as Vec2,
      flippable: !segment.closed && policy.allowsReverse,
    })),
    {
      start,
      returnTo: refinement.returnTo,
      pinFirst: refinement.pinFirst,
      ...(holds?.any === true ? { holds: routeHolds(holds, indices) } : {}),
    },
  );
  const ordered =
    refined === null
      ? segments
      : refined.order.map((at) => {
          const segment = segments[at] as T;
          return refined.flipped[at] === true ? reverseSegment(segment) : segment;
        });
  // Under Nearest point or Nearest corner, each closed start is chosen again
  // where the head now arrives (a given-order base still has drawn starts).
  if (policy.closedShapeStart === 'drawn') return [...ordered];
  const restarted = restartClosedSegments(ordered, start, policy);
  // Refinement scored the old entry/exit points. Moving a closed start also
  // changes its outgoing hop, so a locally nearer start can undo the saving.
  // Compare the complete route, including the park, with the valid base (its
  // holds and pinned first contour already checked when it was selected). The
  // base keeps its order but takes the same start policy: a given-order base
  // still has drawn starts, which the operator's setting replaces.
  const base = restartClosedSegments(segments, start, policy);
  return routeCost(restarted, start, refinement.returnTo) <=
    routeCost(base, start, refinement.returnTo)
    ? restarted
    : base;
}

// Holds re-indexed from source segments to their route positions.
function routeHolds(holds: InsideFirstHolds, indices: ReadonlyArray<number>): InsideFirstHolds {
  const position = new Map(indices.map((source, at) => [source, at]));
  const remap = (list: ReadonlyArray<number>): number[] =>
    list.flatMap((source) => {
      const at = position.get(source);
      return at === undefined ? [] : [at];
    });
  return {
    holds: indices.map((source) => remap(holds.holds[source] ?? [])),
    heldBy: indices.map((source) => remap(holds.heldBy[source] ?? [])),
    any: holds.any,
  };
}

// The refined order changes where the head arrives at each closed segment;
// pick its start again from there under the same closedShapeStart policy.
function restartClosedSegments<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  start: Vec2,
  policy: EntryPolicy,
): T[] {
  let cursor = start;
  return segments.map((segment) => {
    const started = segment.closed
      ? startClosedSegmentAt(segment, nearestClosedStart(segment, cursor, policy.closedShapeStart))
      : segment;
    const last = started.polyline[started.polyline.length - 1];
    if (last !== undefined) cursor = last;
    return started;
  });
}

/**
 * Keep source order (LBG-C04): the segments keep their order and direction,
 * but each closed one starts at its candidate nearest where the previous one
 * ended, the first nearest the planning start. 'drawn' returns them as given.
 */
export function sourceOrderClosedShapeStarts<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  settings: Pick<SegmentOrderSettings, 'startPoint' | 'closedShapeStart'>,
): ReadonlyArray<T> {
  const policy = settings.closedShapeStart ?? 'drawn';
  if (policy === 'drawn') return segments;
  let cursor = startCursorForSegments(segments, settings.startPoint);
  return segments.map((segment) => {
    const started = segment.closed
      ? startClosedSegmentAt(segment, nearestClosedStart(segment, cursor, policy))
      : segment;
    const last = started.polyline[started.polyline.length - 1];
    if (last !== undefined) cursor = last;
    return started;
  });
}

/** Computes the selected planning seed without allocating a bounds array. */
export function startCursorForSegments(
  segments: ReadonlyArray<CutSegment>,
  policy: SegmentOrderSettings['startPoint'],
): Vec2 {
  if (policy === 'machine-origin') return ORIGIN;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    const bounds = polylineBounds(segment.polyline);
    if (bounds === null) continue;
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  if (!Number.isFinite(minX)) return ORIGIN;
  if (policy === 'job-lower-left') return { x: minX, y: minY };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

// The former depth-major inside-first order: every deeper contour of the group
// before any shallower one. Kept only as the fallback for a stalled route.
function depthMajorNearestNeighborOrder<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  startCursor: Vec2,
  policy: EntryPolicy,
): T[] {
  const buckets = bucketSegmentsByContainmentDepth(segments, containmentDepths(segments));

  const out: T[] = [];
  let cursor = startCursor;
  for (const [, bucket] of [...buckets.entries()].sort(([left], [right]) => right - left)) {
    const ordered = nearestNeighborOrderFrom(bucket, cursor, policy);
    for (const segment of ordered.segments) out.push(segment);
    cursor = ordered.cursor;
  }
  return out;
}

/** Groups each segment exactly once before descending inside-first planning. */
export function bucketSegmentsByContainmentDepth<T>(
  segments: ReadonlyArray<T>,
  depths: ReadonlyArray<number>,
): Map<number, T[]> {
  const buckets = new Map<number, T[]>();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const depth = depths[index] ?? 0;
    const bucket = buckets.get(depth);
    if (bucket === undefined) buckets.set(depth, [segment]);
    else bucket.push(segment);
  }
  return buckets;
}

type NearestNeighbourRoute<T> = {
  readonly segments: T[];
  /** Source index of each routed segment. */
  readonly indices: number[];
  readonly cursor: Vec2;
  /** A held segment was left unplaced (see configuredSegmentOrder). */
  readonly stalled: boolean;
};

// With holds, only a segment nothing deeper still waits inside is eligible,
// so a part's inner shapes run just before its outline (ADR-669).
function nearestNeighborOrderFrom<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  startCursor: Vec2,
  policy: EntryPolicy,
  holds?: InsideFirstHolds,
): NearestNeighbourRoute<T> {
  const nearest = createNearestEntryQuery(collectSegmentEntries(segments, policy));
  const placed = new Set<number>();
  const isAvailable = (index: number): boolean => !placed.has(index);
  const gate = holdGate(holds);
  const out: T[] = [];
  const indices: number[] = [];
  let cursor = startCursor;
  for (;;) {
    const pick = nearest(cursor, isAvailable, gate.isEligible);
    if (pick === null) break;
    placed.add(pick.segmentIndex);
    gate.release(pick.segmentIndex);
    const segment = segments[pick.segmentIndex];
    if (segment === undefined) continue;
    const next = pick.reverse
      ? reverseSegment(segment)
      : startClosedSegmentAt(segment, pick.vertexIndex ?? 0);
    out.push(next);
    indices.push(pick.segmentIndex);
    const last = next.polyline[next.polyline.length - 1];
    if (last !== undefined) cursor = last;
  }
  const stalled = segments.some((_, index) => !placed.has(index) && gate.held(index));
  return { segments: out, indices, cursor, stalled };
}

type HoldGate = {
  readonly isEligible: ((index: number) => boolean) | undefined;
  readonly release: (index: number) => void;
  readonly held: (index: number) => boolean;
};

// No holds: every segment is eligible, exactly as before ADR-669.
function holdGate(holds: InsideFirstHolds | undefined): HoldGate {
  if (holds?.any !== true)
    return { isEligible: undefined, release: () => undefined, held: () => false };
  const waiting = waitingCounts(holds);
  return {
    isEligible: (index) => waiting[index] === 0,
    release: (index) => releaseHolds(holds, waiting, index),
    held: (index) => waiting[index] !== 0,
  };
}

// A closed segment offers one entry per candidate start vertex (LBG-C04); the
// index's vertexIndex tie-break keeps its drawn start ahead on exact ties.
// Under 'drawn' every segment offers exactly the entries it always did.
export function collectSegmentEntries(
  segments: ReadonlyArray<CutSegment>,
  policy: EntryPolicy,
): SegmentEntry[] {
  const entries: SegmentEntry[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    const start = segment.polyline[0];
    if (start === undefined) continue;
    if (segment.closed && policy.closedShapeStart !== 'drawn') {
      pushClosedStartEntries(entries, segment, index, policy.closedShapeStart);
      continue;
    }
    entries.push({ point: start, segmentIndex: index, reverse: false });
    const end = segment.polyline[segment.polyline.length - 1];
    if (!segment.closed && policy.allowsReverse && end !== undefined) {
      entries.push({ point: end, segmentIndex: index, reverse: true });
    }
  }
  return entries;
}

function pushClosedStartEntries(
  entries: SegmentEntry[],
  segment: CutSegment,
  segmentIndex: number,
  policy: ClosedShapeStart,
): void {
  for (const vertexIndex of closedStartCandidates(segment, policy)) {
    const point = segment.polyline[vertexIndex];
    if (point !== undefined) entries.push({ point, segmentIndex, reverse: false, vertexIndex });
  }
}

// Candidates are only offered where the rotation keeps any arcs, so the
// fallback to the drawn start is defensive, never a silent arc drop.
function startClosedSegmentAt<T extends CutSegment>(segment: T, vertexIndex: number): T {
  if (vertexIndex === 0) return segment;
  return rotateClosedCutSegment(segment, vertexIndex) ?? segment;
}

function reverseSegment<T extends CutSegment>(segment: T): T {
  return reverseCutSegment(segment);
}
