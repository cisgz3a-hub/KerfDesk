// How large the two head markers draw for a given program (ADR-255 stage 9d).
//
// Split from scene-markers so the sizing rule is a pure function testable
// without WebGL or a three.js mesh (the ADR-102 §2 pure-seam pattern).

import type { Viewer3dSegmentsInput } from './segment-buckets';

const MARKER_RADIUS_FRACTION = 0.012;
/** Floor so the marker stays visible on a program smaller than ~33mm. */
export const MARKER_MIN_RADIUS_MM = 0.4;
const AXIS_COUNT = 3;
const POINTS_PER_SEGMENT = 2;

/**
 * Marker radius in mm: a fraction of the program's largest bounding-box
 * extent, floored so tiny programs still show a marker.
 */
export function markerRadiusMm(segments: Viewer3dSegmentsInput): number {
  return Math.max(MARKER_MIN_RADIUS_MM, largestExtentMm(segments) * MARKER_RADIUS_FRACTION);
}

/**
 * The longest side of the program's bounding box (0 when it has no points).
 *
 * Measuring the extent rather than the largest absolute coordinate keeps the
 * marker the same size when a job is rotated or parked away from the origin —
 * distance from the origin is not a size. One pass per axis rather than one
 * fused pass: this runs once per program load, not per frame.
 */
function largestExtentMm(segments: Viewer3dSegmentsInput): number {
  const pointCount = segments.segmentCount * POINTS_PER_SEGMENT;
  if (pointCount === 0) return 0;
  let extent = 0;
  for (let axis = 0; axis < AXIS_COUNT; axis += 1) {
    let min = Infinity;
    let max = -Infinity;
    for (let point = 0; point < pointCount; point += 1) {
      const value = segments.positions[point * AXIS_COUNT + axis] ?? 0;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    extent = Math.max(extent, max - min);
  }
  return extent;
}
