// Segment ordering primitives for the path optimizer. Keeping this focused
// module separate lets optimize-paths own group orchestration only.

import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import {
  closedSegmentEntries,
  enterClosedSegment,
  hasMovableStart,
  type ClosedCutStartPolicy,
} from './closed-cut-start';
import { containmentDepths } from './containment-depth';
import type { CutSegment } from './job';
import { polylineBounds } from './segment-bounds';
import { createNearestEntryQuery, type SegmentEntry } from './segment-entry-index';

const ORIGIN: Vec2 = { x: 0, y: 0 };

export type SegmentOrderSettings = Pick<
  ProjectOptimizationSettings,
  'insideFirst' | 'pathDirection' | 'startPoint'
>;

// `closedStart` (ADR-385) is passed for Line cut groups only; null keeps every
// closed segment entered at its first point, exactly as before.
export function configuredSegmentOrder<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  settings: SegmentOrderSettings,
  closedStart: ClosedCutStartPolicy | null = null,
): T[] {
  const startCursor = startCursorForSegments(segments, settings.startPoint);
  const planner = {
    allowsReverse: settings.pathDirection === 'allow-reverse',
    closedStart,
  };
  if (!settings.insideFirst) {
    return nearestNeighborOrderFrom(segments, startCursor, planner).segments;
  }
  return insideFirstNearestNeighborOrder(segments, startCursor, planner);
}

type EntryPlanner = {
  readonly allowsReverse: boolean;
  readonly closedStart: ClosedCutStartPolicy | null;
};

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
  planner: EntryPlanner,
): T[] {
  const buckets = bucketSegmentsByContainmentDepth(segments, containmentDepths(segments));

  const out: T[] = [];
  let cursor = startCursor;
  for (const [, bucket] of [...buckets.entries()].sort(([left], [right]) => right - left)) {
    const ordered = nearestNeighborOrderFrom(bucket, cursor, planner);
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
  planner: EntryPlanner,
): { readonly segments: T[]; readonly cursor: Vec2 } {
  const nearest = createNearestEntryQuery(collectSegmentEntries(segments, planner));
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
    const next = placeSegment(segment, pick, cursor, planner.closedStart);
    out.push(next);
    const last = next.polyline[next.polyline.length - 1];
    if (last !== undefined) cursor = last;
  }
  return { segments: out, cursor };
}

function placeSegment<T extends CutSegment>(
  segment: T,
  pick: SegmentEntry,
  cursor: Vec2,
  closedStart: ClosedCutStartPolicy | null,
): T {
  if (pick.reverse) return reverseSegment(segment);
  if (closedStart === null) return segment;
  return enterClosedSegment(segment, pick.vertexIndex ?? 0, cursor, closedStart);
}

function collectSegmentEntries(
  segments: ReadonlyArray<CutSegment>,
  { allowsReverse, closedStart }: EntryPlanner,
): SegmentEntry[] {
  const entries: SegmentEntry[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;
    if (closedStart !== null && hasMovableStart(segment)) {
      for (const entry of closedSegmentEntries(segment, index, closedStart)) entries.push(entry);
      continue;
    }
    const start = segment.polyline[0];
    if (start === undefined) continue;
    entries.push({ point: start, segmentIndex: index, reverse: false });
    const end = segment.polyline[segment.polyline.length - 1];
    if (!segment.closed && allowsReverse && end !== undefined) {
      entries.push({ point: end, segmentIndex: index, reverse: true });
    }
  }
  return entries;
}

function reverseSegment<T extends CutSegment>(segment: T): T {
  return { ...segment, polyline: [...segment.polyline].reverse(), closed: segment.closed };
}
