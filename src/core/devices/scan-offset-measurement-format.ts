export type ScanOffsetMeasurementConvention =
  | 'laserforge-full-reverse-only'
  | 'lightburn-half-both-directions';

export type ScanOffsetSpeedUnit = 'mm-per-minute' | 'mm-per-second';

const SECONDS_PER_MINUTE = 60;
const LIGHTBURN_PAIR_SHIFT_FACTOR = 2;

/** Convert an entered calibration speed to LaserForge's persisted mm/min unit. */
export function scanOffsetSpeedToMmPerMin(value: number, unit: ScanOffsetSpeedUnit): number {
  return unit === 'mm-per-second' ? value * SECONDS_PER_MINUTE : value;
}

/** Convert a persisted LaserForge speed to the operator-selected entry unit. */
export function scanOffsetSpeedFromMmPerMin(value: number, unit: ScanOffsetSpeedUnit): number {
  return unit === 'mm-per-second' ? value / SECONDS_PER_MINUTE : value;
}

/**
 * Convert an entered offset to LaserForge's full signed reverse-row correction.
 * LightBurn asks for half the measured pair separation because it moves both
 * scan directions; LaserForge keeps forward rows anchored and moves reverse
 * rows by the full separation.
 */
export function scanOffsetMeasurementToLaserForge(
  value: number,
  convention: ScanOffsetMeasurementConvention,
): number {
  return convention === 'lightburn-half-both-directions'
    ? value * LIGHTBURN_PAIR_SHIFT_FACTOR
    : value;
}

/** Convert a LaserForge correction for display in the selected convention. */
export function scanOffsetMeasurementFromLaserForge(
  value: number,
  convention: ScanOffsetMeasurementConvention,
): number {
  return convention === 'lightburn-half-both-directions'
    ? value / LIGHTBURN_PAIR_SHIFT_FACTOR
    : value;
}
