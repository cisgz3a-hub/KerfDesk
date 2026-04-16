/**
 * @file ScanningOffset.ts
 * @copyright (c) 2025 LaserForge. All rights reserved.
 *
 * Scanning offset adjustment compensates for laser beam firing latency
 * during raster engraving. At fast scan speeds, the laser's response
 * delay causes the burn to shift in the direction of travel. Without
 * correction, bidirectional scan lines appear offset from each other.
 *
 * Physics:
 *   offset_mm = latency_seconds * velocity_mm_per_s
 *
 * This means offset scales linearly with speed. In practice users
 * calibrate a few speed points and we interpolate between them.
 */

/**
 * A single calibration point: at `speedMmPerMin`, the beam burns this many
 * mm ahead of the commanded position (positive = shift in direction of travel).
 */
export interface ScanningOffsetPoint {
  speedMmPerMin: number;
  offsetMm: number;
}

/**
 * A scanning offset table is a sparse list of calibration points.
 * We interpolate linearly between them.
 */
export type ScanningOffsetTable = ScanningOffsetPoint[];

/**
 * Default empty table (no correction).
 */
export const EMPTY_OFFSET_TABLE: ScanningOffsetTable = [];

/**
 * Interpolate offset value for a given speed.
 *
 * - If table is empty, returns 0 (no correction).
 * - If speed is below smallest calibration point, uses linear extrapolation
 *   from origin: offset = smallestOffset * (speed / smallestSpeed).
 * - If speed is above largest calibration point, uses linear extrapolation
 *   using the slope between the last two points (or origin-to-last if only
 *   one point).
 * - Otherwise, linear interpolation between bracketing points.
 */
export function interpolateOffset(table: ScanningOffsetTable, speedMmPerMin: number): number {
  if (table.length === 0) return 0;

  // Sort by speed (defensive — UI might insert out of order)
  const sorted = [...table].sort((a, b) => a.speedMmPerMin - b.speedMmPerMin);

  if (sorted.length === 1) {
    // Linear from origin
    const p = sorted[0];
    if (p.speedMmPerMin <= 0) return 0;
    return p.offsetMm * (speedMmPerMin / p.speedMmPerMin);
  }

  // Below first point: linear from origin to first point
  if (speedMmPerMin <= sorted[0].speedMmPerMin) {
    const p = sorted[0];
    if (p.speedMmPerMin <= 0) return 0;
    return p.offsetMm * (speedMmPerMin / p.speedMmPerMin);
  }

  // Above last point: extrapolate using last segment's slope
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  if (speedMmPerMin >= last.speedMmPerMin) {
    const dx = last.speedMmPerMin - prev.speedMmPerMin;
    if (dx === 0) return last.offsetMm;
    const slope = (last.offsetMm - prev.offsetMm) / dx;
    return last.offsetMm + slope * (speedMmPerMin - last.speedMmPerMin);
  }

  // Find bracketing points
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (speedMmPerMin >= a.speedMmPerMin && speedMmPerMin <= b.speedMmPerMin) {
      const dx = b.speedMmPerMin - a.speedMmPerMin;
      if (dx === 0) return a.offsetMm;
      const t = (speedMmPerMin - a.speedMmPerMin) / dx;
      return a.offsetMm + t * (b.offsetMm - a.offsetMm);
    }
  }

  // Shouldn't reach here
  return 0;
}

/**
 * Apply scanning offset to the start and end X coordinates of a scan line.
 *
 * For a scan moving in +X direction (left-to-right), the burn lands at
 * commanded position + offset. To compensate, we shift the commanded
 * positions backward by offset. For -X direction, shift forward.
 *
 * @param startX       Original commanded start X
 * @param endX         Original commanded end X
 * @param offsetMm     Interpolated offset for current speed (>= 0 typically)
 * @returns            Adjusted start/end X
 */
export function applyScanOffset(
  startX: number,
  endX: number,
  offsetMm: number,
): { startX: number; endX: number } {
  if (offsetMm === 0) return { startX, endX };
  const direction = endX >= startX ? 1 : -1;
  const shift = direction * offsetMm;
  return {
    startX: startX - shift,
    endX: endX - shift,
  };
}

/**
 * Generate a default calibration table for a user who hasn't calibrated yet.
 * Returns a sensible starting guess based on typical diode laser latency (~0.5ms).
 * The user should override this by running the calibration workflow.
 */
export function suggestedDefaultTable(): ScanningOffsetTable {
  // Typical diode laser latency ~0.5ms = 0.0005s
  // At 3000 mm/min (50 mm/s): offset = 0.0005 * 50 = 0.025mm
  // At 6000 mm/min (100 mm/s): offset = 0.0005 * 100 = 0.05mm
  return [
    { speedMmPerMin: 3000, offsetMm: 0.025 },
    { speedMmPerMin: 6000, offsetMm: 0.05 },
  ];
}
