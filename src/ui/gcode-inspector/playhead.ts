// Playhead math for Inspector playback (ADR-255 stage 5). Pure and
// unit-testable: given a route position in mm, find the active segment and
// interpolate WITHIN it (never snapping to segment boundaries — the CAMotics
// getPtAtTime behavior operators expect from a simulator).
//
// v1 parameterizes playback by route distance. Stage 8 swaps the parameter
// for planner-true seconds; this module's shape does not change.

import type { InspectorRenderModel } from './inspector-model';

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

/**
 * Playhead at a moment in PLANNER TIME (ADR-255 stage 8b). Same shape as the
 * distance form, driven by per-segment seconds instead of millimetres, so the
 * tool visibly slows into corners the way the machine will.
 *
 * Position within the active segment is interpolated linearly in time. Inside
 * one short move that is a close approximation; across the program the timing
 * is the planner's, not a constant-speed guess.
 */
export function playheadAtTime(
  model: InspectorRenderModel,
  segTimeEndSec: Float32Array,
  seconds: number,
): PlayheadState {
  return playheadFromCumulative(model, segTimeEndSec, seconds);
}

function playheadFromCumulative(
  model: InspectorRenderModel,
  cumulative: Float32Array,
  value: number,
): PlayheadState {
  if (model.segmentCount === 0) {
    return { routeMm: 0, segmentIndex: -1, point: null, segmentFraction: 0 };
  }
  // Clamp against the cumulative array's OWN last entry, not a separately
  // accumulated total: the array is Float32 and the total Float64, so the
  // two disagree in the last ulp and the end of the program would land a
  // hair short of the final vertex.
  const clamped = Math.min(Math.max(value, 0), cumulative[model.segmentCount - 1] ?? 0);
  const segmentIndex = indexInCumulative(cumulative, model.segmentCount, clamped);
  const start = segmentIndex === 0 ? 0 : (cumulative[segmentIndex - 1] ?? 0);
  const end = cumulative[segmentIndex] ?? start;
  const span = end - start;
  const fraction = span <= 0 ? 1 : Math.min(Math.max((clamped - start) / span, 0), 1);
  return {
    routeMm: clamped,
    segmentIndex,
    point: interpolateSegment(model.positions, segmentIndex, fraction),
    segmentFraction: fraction,
  };
}

/**
 * The first move a playback trail of `windowSeconds` keeps: the one under way
 * that many seconds before `seconds`, or the first move until the trail has
 * run its length (ADR-470).
 */
export function trailStartSegment(
  segTimeEndSec: Float32Array,
  segmentCount: number,
  seconds: number,
  windowSeconds: number,
): number {
  const from = seconds - windowSeconds;
  if (windowSeconds <= 0 || segmentCount === 0 || from <= 0) return 0;
  return indexInCumulative(segTimeEndSec, segmentCount, from);
}

// Moves ending within this of the playhead count as where it already is.
const MOVE_STEP_EPSILON_SEC = 1e-4;

/**
 * Where stepping one move from `seconds` lands: the end of the next move
 * forward, or of the previous one back (0 before the first). Moves that take
 * no time are stepped over (ADR-470).
 */
export function stepMoveSeconds(
  segTimeEndSec: Float32Array,
  segmentCount: number,
  seconds: number,
  direction: 1 | -1,
): number {
  if (segmentCount === 0) return 0;
  if (direction > 0) {
    const next = indexInCumulative(segTimeEndSec, segmentCount, seconds + MOVE_STEP_EPSILON_SEC);
    return segTimeEndSec[next] ?? 0;
  }
  const index = indexInCumulative(segTimeEndSec, segmentCount, seconds - MOVE_STEP_EPSILON_SEC);
  const end = segTimeEndSec[index] ?? 0;
  // Every move ends before the playhead: the last one's end is the step.
  if (end < seconds - MOVE_STEP_EPSILON_SEC) return end;
  return index === 0 ? 0 : (segTimeEndSec[index - 1] ?? 0);
}

function indexInCumulative(cumulative: Float32Array, count: number, value: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((cumulative[mid] ?? 0) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Seconds at which a source line's first move begins — the time-domain
 * jump target for click-to-locate. Null when the line emits no motion.
 *
 * Binary search, not a scan: segLine is non-decreasing because the render
 * model is built in one pass over the source, so a click on a line near the
 * end of a large program no longer walks every segment before it. */
export function secondsAtLine(
  model: InspectorRenderModel,
  segTimeEndSec: Float32Array,
  line: number,
): number | null {
  const index = firstSegmentAtOrAfterLine(model.segLine, model.segmentCount, line);
  // The search lands on the first segment at or past the line; a modal or
  // comment line emits nothing, so only an exact match is that line's motion.
  if (index >= model.segmentCount || model.segLine[index] !== line) return null;
  return index === 0 ? 0 : (segTimeEndSec[index - 1] ?? 0);
}

// Lower bound over the non-decreasing source-line column: `count` when every
// segment belongs to an earlier line.
function firstSegmentAtOrAfterLine(segLine: Uint32Array, count: number, line: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((segLine[mid] ?? 0) < line) low = mid + 1;
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
