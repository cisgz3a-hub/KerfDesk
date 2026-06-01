import type { Polyline } from '../../core/scene';
import {
  countPolylineSegments,
  LARGE_SCENE_SEGMENT_THRESHOLD,
  strideForSegmentBudget,
} from './draw-complexity';

export type DisplayPolylines = {
  readonly polylines: ReadonlyArray<Polyline>;
  readonly isSimplified: boolean;
  readonly segmentCount: number;
};

export type DisplayPolylineCache = {
  readonly get: (polylines: ReadonlyArray<Polyline>, budget?: number) => DisplayPolylines;
};

type CacheEntry = DisplayPolylines & { readonly budget: number };

export function createDisplayPolylineCache(): DisplayPolylineCache {
  const bySource = new WeakMap<ReadonlyArray<Polyline>, CacheEntry>();
  return {
    get(polylines, budget = LARGE_SCENE_SEGMENT_THRESHOLD) {
      const cached = bySource.get(polylines);
      if (cached !== undefined && cached.budget === budget) return cached;
      const display = buildDisplayPolylines(polylines, budget);
      const entry: CacheEntry = { ...display, budget };
      bySource.set(polylines, entry);
      return entry;
    },
  };
}

export function buildDisplayPolylines(
  polylines: ReadonlyArray<Polyline>,
  budget: number = LARGE_SCENE_SEGMENT_THRESHOLD,
): DisplayPolylines {
  const segmentCount = countPolylineSegments(polylines);
  const stride = strideForSegmentBudget(segmentCount, budget);
  if (stride === 1) return { polylines, isSimplified: false, segmentCount };
  return {
    polylines: sampleEveryNthSegment(polylines, stride),
    isSimplified: true,
    segmentCount,
  };
}

function sampleEveryNthSegment(
  polylines: ReadonlyArray<Polyline>,
  stride: number,
): ReadonlyArray<Polyline> {
  const sampled: Polyline[] = [];
  let firstGlobalSegment = 0;
  for (const polyline of polylines) {
    const segmentCount = Math.max(0, polyline.points.length - 1);
    const firstLocalSegment = firstSampledLocalSegment(firstGlobalSegment, stride);
    for (
      let localSegment = firstLocalSegment;
      localSegment < segmentCount;
      localSegment += stride
    ) {
      const from = polyline.points[localSegment];
      const to = polyline.points[localSegment + 1];
      if (from === undefined || to === undefined) continue;
      sampled.push({ closed: false, points: [from, to] });
    }
    firstGlobalSegment += segmentCount;
  }
  return sampled;
}

function firstSampledLocalSegment(firstGlobalSegment: number, stride: number): number {
  const remainder = firstGlobalSegment % stride;
  return remainder === 0 ? 0 : stride - remainder;
}
