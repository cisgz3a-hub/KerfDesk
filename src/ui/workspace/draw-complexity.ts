import type { Polyline } from '../../core/scene';

// Above this many segments the canvas draws a DECIMATED display copy (see
// display-polylines.ts). The budget is a parachute for megabyte-scale
// imports, not a normal-path optimisation: with one beginPath/stroke per
// colour (the batching that fixed the post-import freeze) Canvas2D strokes
// ~100k segments per frame comfortably on modest hardware. The old 10k
// budget tripped on a SINGLE traced logo (~10.3k segments), so the primary
// use case rendered as simplified confetti.
export const LARGE_SCENE_SEGMENT_THRESHOLD = 120_000;

// Canvas2D strokes wider than one device pixel go through Skia's full
// stroker (measured ~3 µs per segment: a 120k-segment display cost ~380 ms
// per repaint on an Iris Xe laptop), while a stroke of at most one device
// pixel takes the hairline scan converter (~0.05 µs per segment, ~6 ms for
// the same display). Ordinary artwork keeps its 1.5 px weight; an object
// this dense draws as a 1 px hairline instead, which is display policy only
// (ADR-346) — emitted output never reads a display width.
export const HAIRLINE_STROKE_SEGMENT_THRESHOLD = 20_000;
export const ARTWORK_STROKE_WIDTH_PX = 1.5;
export const ARTWORK_HAIRLINE_WIDTH_PX = 1;
export const NON_OUTPUT_STROKE_WIDTH_PX = 0.75;

/** Device-pixel stroke width for an object's artwork given its display size. */
export function artworkStrokeWidthPx(displaySegmentCount: number, output: boolean): number {
  if (!output) return NON_OUTPUT_STROKE_WIDTH_PX;
  return displaySegmentCount >= HAIRLINE_STROKE_SEGMENT_THRESHOLD
    ? ARTWORK_HAIRLINE_WIDTH_PX
    : ARTWORK_STROKE_WIDTH_PX;
}

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
