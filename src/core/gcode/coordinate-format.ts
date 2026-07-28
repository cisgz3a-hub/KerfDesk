import type { Vec2 } from '../scene';

/** Number of decimal places written for millimetre G-code coordinates. */
export const GCODE_COORDINATE_DECIMAL_PLACES = 3;

/** Formats one millimetre coordinate and canonicalizes negative zero. */
export function formatGcodeCoordinateMm(value: number): string {
  const formatted = value.toFixed(GCODE_COORDINATE_DECIMAL_PLACES);
  return Number(formatted) === 0 ? (0).toFixed(GCODE_COORDINATE_DECIMAL_PLACES) : formatted;
}

/** Returns whether an XY segment survives coordinate formatting as motion. */
export function hasGcodeXyMotionAtEmitPrecision(start: Vec2, end: Vec2): boolean {
  return (
    formatGcodeCoordinateMm(start.x) !== formatGcodeCoordinateMm(end.x) ||
    formatGcodeCoordinateMm(start.y) !== formatGcodeCoordinateMm(end.y)
  );
}
