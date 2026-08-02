// A v-carve offset ladder is produced one inset at a time, and each inset can
// contain contours from several disconnected carved regions. Emitting that raw
// ladder revisits every region at every depth. This module keeps the ladder's
// exact contours and step numbers, but groups them by their source filled
// region so one region is completed before the cutter travels to the next.

import { pointInPolygon } from '../geometry';
import type { Polyline } from '../scene';
import { isClosedFiniteContour, strictContourContainmentDepth } from './strict-contour-nesting';

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

/** Rank an interior witness by the original filled-root order (ADR-270). */
export function vcarveSourceRegionRank(
  witness: { readonly x: number; readonly y: number } | undefined,
  originalContours: ReadonlyArray<Polyline>,
): number {
  return vcarveSourceRegionRankFromLayout(witness, buildVCarveSourceRegionLayout(originalContours));
}

export function buildVCarveSourceRegionLayout(
  originalContours: ReadonlyArray<Polyline>,
): VCarveRegionLayout {
  return strictlyNestedSourceRegions(originalContours);
}

export function vcarveSourceRegionRankFromLayout(
  witness: { readonly x: number; readonly y: number } | undefined,
  sourceLayout: VCarveRegionLayout,
): number {
  return sourceRankFor(witness, sourceLayout);
}

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
    if (!isClosedFiniteContour(contour)) return [];
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
    if (!isClosedFiniteContour(contour)) return [];
    const containmentDepth = strictContourContainmentDepth(contour, index, sourceContours);
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
