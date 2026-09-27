import type { Polyline, Vec2 } from '../scene';
import { contourBox, finiteContourBox, type ContourBox } from '../trace/contour-bounds';
import { ContourBoxIndex } from '../trace/contour-box-index';

export type VCarveSourceRegion = {
  readonly contour: Polyline;
  readonly containmentDepth: number;
  readonly sourceIndex: number;
};

export type VCarveRegionLayout = ReadonlyArray<VCarveSourceRegion>;

type IndexedRegion = ContourBox & {
  readonly region: VCarveSourceRegion;
  readonly index: number;
};

type RegionIndex = {
  readonly candidates: ContourBoxIndex<IndexedRegion>;
  readonly unindexed: ReadonlyArray<IndexedRegion>;
};

// Layouts and their source contours are immutable compilation snapshots. A
// weak sidecar reuses bounds for every witness without retaining older jobs or
// changing the public array representation used by region ordering.
const regionIndexes = new WeakMap<VCarveRegionLayout, RegionIndex>();
const MAX_INDEXED_COORDINATE = Math.sqrt(Number.MAX_VALUE) / 4;
const BOUNDS_PADDING_ULPS = 64;

/** Inclusive candidates in the original layout order; point-in-polygon decides membership. */
export function vcarveRegionCandidates(
  regions: VCarveRegionLayout,
  point: Vec2,
): ReadonlyArray<{ readonly region: VCarveSourceRegion; readonly index: number }> {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return regions.map((region, index) => ({ region, index }));
  }
  let prepared = regionIndexes.get(regions);
  if (prepared === undefined) {
    prepared = prepareRegionIndex(regions);
    regionIndexes.set(regions, prepared);
  }
  const found = prepared.candidates.query({
    minX: point.x,
    minY: point.y,
    maxX: point.x,
    maxY: point.y,
  });
  return [...found, ...prepared.unindexed].sort((a, b) => a.index - b.index);
}

function prepareRegionIndex(regions: VCarveRegionLayout): RegionIndex {
  const indexed: IndexedRegion[] = [];
  const unindexed: IndexedRegion[] = [];
  regions.forEach((region, index) => {
    const bounds = contourBox(region.contour.points);
    const scale = Math.max(
      1,
      Math.abs(bounds.minX),
      Math.abs(bounds.maxX),
      Math.abs(bounds.minY),
      Math.abs(bounds.maxY),
    );
    if (!finiteContourBox(bounds) || scale > MAX_INDEXED_COORDINATE) {
      // Preserve the existing predicate on unsupported numeric extremes: its
      // ray intersection arithmetic may overflow beyond the geometric box.
      unindexed.push({ ...bounds, region, index });
      return;
    }
    // Retain points just beyond an endpoint box when ray arithmetic rounds a
    // crossing outwards. The broad phase must never redefine boundary contact.
    const padding = Number.EPSILON * BOUNDS_PADDING_ULPS * scale;
    indexed.push({
      region,
      index,
      minX: bounds.minX - padding,
      minY: bounds.minY - padding,
      maxX: bounds.maxX + padding,
      maxY: bounds.maxY + padding,
    });
  });
  return { candidates: ContourBoxIndex.create(indexed), unindexed };
}
