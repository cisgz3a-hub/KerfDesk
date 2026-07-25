// Playhead math for Inspector playback (ADR-255 stage 5). Pure and
// unit-testable: given a route position in mm, find the active segment and
// interpolate WITHIN it (never snapping to segment boundaries — the CAMotics
// getPtAtTime behavior operators expect from a simulator).
//
// v1 parameterizes playback by route distance. Stage 8 swaps the parameter
// for planner-true seconds; this module's shape does not change.

import type { GcodeRenderModel } from '../../core/gcode-view';

export type PlayheadPoint = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type PlayheadState = {
  /** Clamped route position in mm. */
  readonly routeMm: number;
  /** Active segment, or -1 before any motion exists. */
  readonly segmentIndex: number;
  /** Interpolated tool position, or null when the program has no motion. */
  readonly point: PlayheadPoint | null;
  /** 0..1 progress within the active segment. */
  readonly segmentFraction: number;
};

export function playheadAt(model: GcodeRenderModel, routeMm: number): PlayheadState {
  if (model.segmentCount === 0) {
    return { routeMm: 0, segmentIndex: -1, point: null, segmentFraction: 0 };
  }
  const clamped = Math.min(Math.max(routeMm, 0), model.totalRouteMm);
  const segmentIndex = segmentIndexAtRoute(model, clamped);
  const start = segmentIndex === 0 ? 0 : (model.segRouteEndMm[segmentIndex - 1] ?? 0);
  const end = model.segRouteEndMm[segmentIndex] ?? start;
  const span = end - start;
  const fraction = span <= 0 ? 1 : Math.min(Math.max((clamped - start) / span, 0), 1);
  return {
    routeMm: clamped,
    segmentIndex,
    point: interpolateSegment(model.positions, segmentIndex, fraction),
    segmentFraction: fraction,
  };
}

/** First segment whose cumulative route end reaches `routeMm` (binary search
 * over the monotonic route array). */
export function segmentIndexAtRoute(model: GcodeRenderModel, routeMm: number): number {
  let low = 0;
  let high = model.segmentCount - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((model.segRouteEndMm[mid] ?? 0) < routeMm) low = mid + 1;
    else high = mid;
  }
  return low;
}

function interpolateSegment(
  positions: Float32Array,
  index: number,
  fraction: number,
): PlayheadPoint {
  const base = index * 6;
  const x0 = positions[base] ?? 0;
  const y0 = positions[base + 1] ?? 0;
  const z0 = positions[base + 2] ?? 0;
  const x1 = positions[base + 3] ?? 0;
  const y1 = positions[base + 4] ?? 0;
  const z1 = positions[base + 5] ?? 0;
  return {
    x: x0 + (x1 - x0) * fraction,
    y: y0 + (y1 - y0) * fraction,
    z: z0 + (z1 - z0) * fraction,
  };
}
