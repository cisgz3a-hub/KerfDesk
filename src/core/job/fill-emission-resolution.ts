import type { Vec2 } from '../scene';
import { hasGcodeXyMotionAtEmitPrecision } from '../gcode';

/** Returns whether a fill run remains motion at emitted precision. A run is two
 * points, or a curve a rotary taper warp made of it (ADR-694 Amendment 1). */
export function isEmittableFillSegment(segment: {
  readonly polyline: ReadonlyArray<Vec2>;
}): boolean {
  const points = segment.polyline;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    if (hasGcodeXyMotionAtEmitPrecision(a, b)) return true;
  }
  return false;
}
