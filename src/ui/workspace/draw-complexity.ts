import type { Polyline } from '../../core/scene';

// Above this many segments the canvas draws a DECIMATED display copy (see
// display-polylines.ts). The budget is a parachute for megabyte-scale
// imports, not a normal-path optimisation: with one beginPath/stroke per
// colour (the batching that fixed the post-import freeze) Canvas2D strokes
// ~100k segments per frame comfortably on modest hardware. The old 10k
// budget tripped on a SINGLE traced logo (~10.3k segments), so the primary
// use case rendered as simplified confetti.
export const LARGE_SCENE_SEGMENT_THRESHOLD = 120_000;

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
