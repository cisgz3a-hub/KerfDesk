// A v-carve offset ladder is produced one inset at a time, and each inset can
// contain contours from several disconnected carved regions. Emitting that raw
// ladder revisits every region at every depth. This module keeps the ladder's
// exact contours and step numbers, but groups them by their source filled
// region so one region is completed before the cutter travels to the next.

import { pointInPolygon } from '../geometry';
import type { Polyline } from '../scene';

export type OrderedVCarvePolyline = {
  readonly step: number;
  readonly polyline: Polyline;
};

type SourceRegion = {
  readonly contour: Polyline;
  readonly containmentDepth: number;
  readonly sourceIndex: number;
};

export type VCarveRegionLayout = ReadonlyArray<SourceRegion>;

/**
 * Return every ladder contour exactly once, annotated with the original ladder
 * step that determines its Z depth. Filled regions follow source-contour order;
 * steps and contours within a region keep the offset engine's order.
 *
 * Source contours use even-odd fill semantics. Even containment depths are
 * filled-region roots (an outer at depth 0, or an island at depth 2/4/...);
 * odd depths are holes and stay with their nearest containing filled root.
 */
export function vcarveRegionOrder(
  sourceContours: ReadonlyArray<Polyline>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<OrderedVCarvePolyline> {
  return vcarveRegionBuckets(sourceContours, rings).flat();
}

/**
 * Build the one region layout shared by every ring stage. Normalized contours
 * are the actual non-intersecting even-odd filled roots; original contours
 * contribute source rank only. Planned inset rings provide interior witnesses,
 * avoiding boundary probes on normalized roots.
 */
export function buildVCarveRegionLayout(
  normalizedContours: ReadonlyArray<Polyline>,
  originalContours: ReadonlyArray<Polyline>,
  witnessRings: ReadonlyArray<ReadonlyArray<Polyline>>,
): VCarveRegionLayout {
  // Boolean-normalized roots may still touch at a vertex. A boundary probe can
  // mistake that contact for containment and erase a real filled root, so the
  // layout uses the same whole-contour nesting proof as provenance ranking.
  const regions = strictlyNestedSourceRegions(normalizedContours);
  if (regions.length <= 1) return regions;

  const originalRoots = strictlyNestedSourceRegions(originalContours);
  const witnesses = firstWitnessByRegion(regions, witnessRings);
  return regions
    .map((region, normalizedIndex) => ({
      region,
      normalizedIndex,
      sourceRank: sourceRankFor(witnesses[normalizedIndex], originalRoots),
    }))
    .sort((a, b) => a.sourceRank - b.sourceRank || a.normalizedIndex - b.normalizedIndex)
    .map(({ region }) => region);
}

/**
 * The same region assignment, kept per bucket: one bucket per filled source
 * region in source order, then one trailing bucket for contours matching no
 * region. Bucket layout depends only on `sourceContours`, so two ring sets
 * bucketed against the same sources zip by index — the ladder zips its δ
 * rings with the thin-detail rings (ADR-282) so a region finishes BOTH before
 * the cutter travels on, keeping ADR-270's promise. An empty ring set returns
 * no buckets.
 */
export function vcarveRegionBuckets(
  sourceContours: ReadonlyArray<Polyline>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<ReadonlyArray<OrderedVCarvePolyline>> {
  return vcarveRegionBucketsWithLayout(nestedSourceRegions(sourceContours), rings);
}

export function vcarveRegionBucketsWithLayout(
  regions: VCarveRegionLayout,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<ReadonlyArray<OrderedVCarvePolyline>> {
  const ladderOrder = flattenLadder(rings);
  if (ladderOrder.length === 0) return [];

  // This is the common single-shape path, and preserving raw ladder order here
  // keeps existing single-region G-code byte-identical.
  if (regions.length <= 1) return [ladderOrder];

  const byRegion: OrderedVCarvePolyline[][] = regions.map(() => []);
  const unassigned: OrderedVCarvePolyline[] = [];
  for (const entry of ladderOrder) {
    const regionIndex = innermostContainingRegion(entry.polyline, regions);
    const bucket = regionIndex < 0 ? unassigned : byRegion[regionIndex];
    bucket?.push(entry);
  }
  return [...byRegion, unassigned];
}

function flattenLadder(rings: ReadonlyArray<ReadonlyArray<Polyline>>): OrderedVCarvePolyline[] {
  return rings.flatMap((ring, step) => ring.map((polyline) => ({ step, polyline })));
}

function nestedSourceRegions(sourceContours: ReadonlyArray<Polyline>): SourceRegion[] {
  return sourceContours.flatMap((contour, index) => {
    const probe = contour.points[0];
    if (probe === undefined) return [];
    const containmentDepth = sourceContours.reduce((depth, candidate, candidateIndex) => {
      if (
        candidateIndex === index ||
        !candidate.closed ||
        candidate.points.length < 3 ||
        !pointInPolygon(probe, candidate.points)
      ) {
        return depth;
      }
      return depth + 1;
    }, 0);
    return containmentDepth % 2 === 0 ? [{ contour, containmentDepth, sourceIndex: index }] : [];
  });
}

// Original paths can partially overlap or self-intersect, so a first-point
// probe cannot establish their nesting. Only whole-contour containment may
// classify a source path as a hole/island for provenance ranking.
function strictlyNestedSourceRegions(sourceContours: ReadonlyArray<Polyline>): SourceRegion[] {
  return sourceContours.flatMap((contour, index) => {
    const containmentDepth = sourceContours.reduce(
      (depth, candidate, candidateIndex) =>
        candidateIndex !== index && strictlyContains(candidate, contour) ? depth + 1 : depth,
      0,
    );
    return containmentDepth % 2 === 0 ? [{ contour, containmentDepth, sourceIndex: index }] : [];
  });
}

function firstWitnessByRegion(
  regions: ReadonlyArray<SourceRegion>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<{ readonly x: number; readonly y: number } | undefined> {
  const witnesses: Array<{ readonly x: number; readonly y: number } | undefined> = regions.map(
    () => undefined,
  );
  for (const { polyline } of flattenLadder(rings)) {
    const regionIndex = innermostContainingRegion(polyline, regions);
    if (regionIndex >= 0 && witnesses[regionIndex] === undefined) {
      witnesses[regionIndex] = polyline.points[0];
    }
  }
  return witnesses;
}

function sourceRankFor(
  witness: { readonly x: number; readonly y: number } | undefined,
  originalRoots: ReadonlyArray<SourceRegion>,
): number {
  if (witness === undefined) return Number.MAX_SAFE_INTEGER;
  let rank = Number.MAX_SAFE_INTEGER;
  let deepest = -1;
  for (const root of originalRoots) {
    if (!pointInPolygon(witness, root.contour.points)) continue;
    if (root.containmentDepth > deepest) {
      deepest = root.containmentDepth;
      rank = root.sourceIndex;
    } else if (root.containmentDepth === deepest) {
      rank = Math.min(rank, root.sourceIndex);
    }
  }
  return rank;
}

function strictlyContains(outer: Polyline, inner: Polyline): boolean {
  const probe = inner.points[0];
  if (probe === undefined || !boundsContain(outer, inner) || boundariesIntersect(outer, inner)) {
    return false;
  }
  return pointInPolygon(probe, outer.points);
}

type Bounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function boundsContain(outer: Polyline, inner: Polyline): boolean {
  const a = polylineBounds(outer);
  const b = polylineBounds(inner);
  return a.minX <= b.minX && a.minY <= b.minY && a.maxX >= b.maxX && a.maxY >= b.maxY;
}

function polylineBounds(polyline: Polyline): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function boundariesIntersect(a: Polyline, b: Polyline): boolean {
  const aCount = distinctClosedPointCount(a);
  const bCount = distinctClosedPointCount(b);
  for (let ai = 0; ai < aCount; ai += 1) {
    const a0 = a.points[ai];
    const a1 = a.points[(ai + 1) % aCount];
    if (a0 === undefined || a1 === undefined) continue;
    for (let bi = 0; bi < bCount; bi += 1) {
      const b0 = b.points[bi];
      const b1 = b.points[(bi + 1) % bCount];
      if (b0 !== undefined && b1 !== undefined && segmentsIntersect(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function distinctClosedPointCount(polyline: Polyline): number {
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  return first !== undefined && last !== undefined && first.x === last.x && first.y === last.y
    ? polyline.points.length - 1
    : polyline.points.length;
}

type Point = { readonly x: number; readonly y: number };

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC === 0 && onSegment(a, b, c)) return true;
  if (abD === 0 && onSegment(a, b, d)) return true;
  if (cdA === 0 && onSegment(c, d, a)) return true;
  if (cdB === 0 && onSegment(c, d, b)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function cross(a: Point, b: Point, point: Point): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function onSegment(a: Point, b: Point, point: Point): boolean {
  return (
    point.x >= Math.min(a.x, b.x) &&
    point.x <= Math.max(a.x, b.x) &&
    point.y >= Math.min(a.y, b.y) &&
    point.y <= Math.max(a.y, b.y)
  );
}

function innermostContainingRegion(
  polyline: Polyline,
  regions: ReadonlyArray<SourceRegion>,
): number {
  const probe = polyline.points[0];
  if (probe === undefined) return -1;
  let match = -1;
  let deepest = -1;
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];
    if (
      region !== undefined &&
      region.containmentDepth > deepest &&
      pointInPolygon(probe, region.contour.points)
    ) {
      match = index;
      deepest = region.containmentDepth;
    }
  }
  return match;
}
