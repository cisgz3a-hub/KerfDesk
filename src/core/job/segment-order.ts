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
import type { CutSegment } from './job';
import { polylineBounds } from './segment-bounds';
import { createNearestEntryQuery, type SegmentEntry } from './segment-entry-index';

const ORIGIN: Vec2 = { x: 0, y: 0 };

// closedShapeStart is optional here: absent means 'drawn', today's behaviour.
export type SegmentOrderSettings = Pick<
  ProjectOptimizationSettings,
  'insideFirst' | 'pathDirection' | 'startPoint'
> &
  Partial<Pick<ProjectOptimizationSettings, 'closedShapeStart'>>;

type EntryPolicy = {
  readonly allowsReverse: boolean;
  readonly closedShapeStart: ClosedShapeStart;
};

export function configuredSegmentOrder<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  settings: SegmentOrderSettings,
): T[] {
  const startCursor = startCursorForSegments(segments, settings.startPoint);
  const policy: EntryPolicy = {
    allowsReverse: settings.pathDirection === 'allow-reverse',
    closedShapeStart: settings.closedShapeStart ?? 'drawn',
  };
  if (!settings.insideFirst) {
    return nearestNeighborOrderFrom(segments, startCursor, policy).segments;
  }
  return insideFirstNearestNeighborOrder(segments, startCursor, policy);
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

function insideFirstNearestNeighborOrder<T extends CutSegment>(
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

function nearestNeighborOrderFrom<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  startCursor: Vec2,
  policy: EntryPolicy,
): { readonly segments: T[]; readonly cursor: Vec2 } {
  const nearest = createNearestEntryQuery(collectSegmentEntries(segments, policy));
  const placed = new Set<number>();
  const isAvailable = (index: number): boolean => !placed.has(index);
  const out: T[] = [];
  let cursor = startCursor;
  for (;;) {
    const pick = nearest(cursor, isAvailable);
    if (pick === null) break;
    placed.add(pick.segmentIndex);
    const segment = segments[pick.segmentIndex];
    if (segment === undefined) continue;
    const next = pick.reverse
      ? reverseSegment(segment)
      : startClosedSegmentAt(segment, pick.vertexIndex ?? 0);
    out.push(next);
    const last = next.polyline[next.polyline.length - 1];
    if (last !== undefined) cursor = last;
  }
  return { segments: out, cursor };
}

// A closed segment offers one entry per candidate start vertex (LBG-C04); the
// index's vertexIndex tie-break keeps its drawn start ahead on exact ties.
// Under 'drawn' every segment offers exactly the entries it always did.
function collectSegmentEntries(
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
