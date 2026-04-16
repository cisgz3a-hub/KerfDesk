/**
 * @file SmartOverscan.ts
 * @copyright (c) 2025 LaserForge. All rights reserved.
 *
 * Computes the required overscan distance for raster engraving based on
 * scan speed and machine acceleration.
 *
 * The laser head must accelerate to scan speed outside the image bounds so
 * the image is engraved at constant velocity. Without enough overscan, the
 * image edges engrave at partial speed → inconsistent burn. With excessive
 * overscan, every scan line wastes travel time.
 *
 * Reference (public domain kinematic equation):
 *   v² = u² + 2·a·s
 *   With u=0 (starting from rest): s = v² / (2·a)
 *
 * This is the minimum distance to accelerate from 0 to v at acceleration a.
 *
 * If acceleration-aware power modulation (Phase 2.6) is enabled, we can
 * technically use zero overscan because power scales with velocity. However
 * we still add a small safety margin because:
 *   - motion planner may undershoot commanded acceleration
 *   - mechanical lag (belt stretch, backlash) isn't captured in pure kinematics
 *   - real machines benefit from ~0.5-1mm margin
 */

export interface SmartOverscanInput {
  /** Target scan speed in mm/min. */
  scanSpeedMmPerMin: number;
  /** Machine maximum acceleration in mm/s². */
  maxAccelMmPerS2: number;
  /**
   * Whether acceleration-aware power modulation (Phase 2.6) is enabled.
   * When true, we can use much less overscan because partial-speed zones
   * still get proportional power.
   */
  accelAwarePowerEnabled: boolean;
  /**
   * User-provided minimum overscan to enforce, mm. Even a well-tuned machine
   * benefits from a small buffer. Default 0.5mm.
   */
  minimumMm?: number;
  /**
   * Safety factor to multiply against the theoretical minimum. 1.0 = exact,
   * 1.2 = 20% margin. Default 1.1.
   */
  safetyFactor?: number;
}

export interface SmartOverscanResult {
  /** Computed overscan distance in mm. */
  overscanMm: number;
  /** Theoretical minimum distance to reach speed (without safety/minimum). */
  theoreticalMinMm: number;
  /** True if the minimum floor (safetyMargin or minimumMm) was the limiting factor. */
  clampedByMinimum: boolean;
}

/**
 * Compute the required overscan distance for a given scan configuration.
 */
export function computeSmartOverscan(input: SmartOverscanInput): SmartOverscanResult {
  const minimumMm = input.minimumMm ?? 0.5;
  const safetyFactor = input.safetyFactor ?? 1.1;

  // Clamp inputs defensively
  const v = Math.max(0, input.scanSpeedMmPerMin) / 60; // mm/s
  const a = Math.max(1, input.maxAccelMmPerS2); // avoid div by zero

  // Theoretical minimum: s = v² / (2·a)
  const theoreticalMinMm = (v * v) / (2 * a);

  // If accel-aware power is enabled, we could use zero, but a small buffer
  // still improves real-world results. Use a reduced safety factor in that case.
  const effectiveSafetyFactor = input.accelAwarePowerEnabled
    ? Math.max(1.0, safetyFactor * 0.3) // 30% of full safety, min 1.0
    : safetyFactor;

  const withSafety = theoreticalMinMm * effectiveSafetyFactor;

  if (withSafety < minimumMm) {
    return {
      overscanMm: minimumMm,
      theoreticalMinMm,
      clampedByMinimum: true,
    };
  }

  return {
    overscanMm: withSafety,
    theoreticalMinMm,
    clampedByMinimum: false,
  };
}

/**
 * Helper for UI: format an overscan value with context about why it's that size.
 */
export function explainOverscan(result: SmartOverscanResult, input: SmartOverscanInput): string {
  const parts: string[] = [];
  parts.push(`${result.overscanMm.toFixed(2)}mm overscan`);

  if (result.clampedByMinimum) {
    parts.push(`(minimum floor, kinematic need only ${result.theoreticalMinMm.toFixed(2)}mm)`);
  } else {
    const speed = input.scanSpeedMmPerMin.toFixed(0);
    const accel = input.maxAccelMmPerS2.toFixed(0);
    parts.push(`(for ${speed} mm/min at ${accel} mm/s² acceleration`);
    if (input.accelAwarePowerEnabled) parts.push(`, accel-aware power reduces safety margin`);
    parts.push(')');
  }

  return parts.join(' ');
}
