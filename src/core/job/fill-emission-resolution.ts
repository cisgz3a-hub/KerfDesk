import type { Vec2 } from '../scene';
import { hasGcodeXyMotionAtEmitPrecision } from '../gcode';

/** Returns whether a two-point fill span remains motion at emitted precision. */
export function isEmittableFillSegment(segment: {
  readonly polyline: ReadonlyArray<Vec2>;
}): boolean {
  const start = segment.polyline[0];
  const end = segment.polyline[1];
  if (start === undefined || end === undefined || segment.polyline.length !== 2) return false;
  return hasGcodeXyMotionAtEmitPrecision(start, end);
}
