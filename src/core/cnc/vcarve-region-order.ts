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
};

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
 * The same region assignment, kept per bucket: one bucket per filled source
 * region in source order, then one trailing bucket for contours matching no
 * region. Bucket layout depends only on `sourceContours`, so two ring sets
 * bucketed against the same sources zip by index — the ladder zips its δ
 * rings with the thin-detail rings (ADR-279) so a region finishes BOTH before
 * the cutter travels on, keeping ADR-270's promise. An empty ring set returns
 * no buckets.
 */
export function vcarveRegionBuckets(
  sourceContours: ReadonlyArray<Polyline>,
  rings: ReadonlyArray<ReadonlyArray<Polyline>>,
): ReadonlyArray<ReadonlyArray<OrderedVCarvePolyline>> {
  const ladderOrder = flattenLadder(rings);
  if (ladderOrder.length === 0) return [];

  const regions = sourceRegions(sourceContours);
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

function sourceRegions(sourceContours: ReadonlyArray<Polyline>): SourceRegion[] {
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
    return containmentDepth % 2 === 0 ? [{ contour, containmentDepth }] : [];
  });
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
