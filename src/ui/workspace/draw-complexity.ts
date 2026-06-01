import type { Polyline } from '../../core/scene';

export const LARGE_SCENE_SEGMENT_THRESHOLD = 10_000;

export function countPolylineSegments(polylines: ReadonlyArray<Polyline>): number {
  let count = 0;
  for (const polyline of polylines) {
    count += Math.max(0, polyline.points.length - 1);
  }
  return count;
}

export function strideForSegmentBudget(
  segmentCount: number,
  budget: number = LARGE_SCENE_SEGMENT_THRESHOLD,
): number {
  if (segmentCount <= budget) return 1;
  return Math.ceil(segmentCount / budget);
}
