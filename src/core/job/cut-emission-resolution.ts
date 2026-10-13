import { hasGcodeXyMotionAtEmitPrecision } from '../gcode/coordinate-format';
import type { CutSegment } from './job';

/** A contour needs a distinct represented XY to emit any laser burn motion.
 * Check the whole path: closed contours normally finish at their start. */
export function isEmittableCutSegment(segment: CutSegment): boolean {
  const first = segment.polyline[0];
  return (
    first !== undefined &&
    segment.polyline.some((point) => hasGcodeXyMotionAtEmitPrecision(first, point))
  );
}
