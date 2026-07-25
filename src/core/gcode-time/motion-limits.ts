// Machine kinematics the time model plans against (ADR-255 stage 8b).
//
// Deliberately a plain value type rather than a DeviceProfile: the Inspector
// reads programs that may not belong to the current machine, so the caller
// decides which limits apply and the core stays pure and testable.

export type MotionLimits = {
  /** GRBL $120/$121 acceleration, mm/sec². */
  readonly accelMmPerSec2: number;
  /** GRBL $11 junction deviation, mm. */
  readonly junctionDeviationMm: number;
  /** GRBL $110/$111 max rate, mm/min — caps both rapids and feed moves. */
  readonly maxFeedMmPerMin: number;
};

export const SECONDS_PER_MINUTE = 60;

/** Guards against a zero/negative limit producing NaN or Infinity time. */
export function sanitizeLimits(limits: MotionLimits): MotionLimits {
  return {
    accelMmPerSec2: Math.max(1, limits.accelMmPerSec2),
    junctionDeviationMm: Math.max(1e-6, limits.junctionDeviationMm),
    maxFeedMmPerMin: Math.max(1, limits.maxFeedMmPerMin),
  };
}
