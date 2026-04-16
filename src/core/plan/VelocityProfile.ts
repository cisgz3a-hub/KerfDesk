/**
 * @file VelocityProfile.ts
 * @copyright (c) 2025 LaserForge. All rights reserved.
 *
 * Computes the trapezoidal velocity profile for a constant-acceleration
 * move. Used to scale laser power with instantaneous velocity so that
 * scan-line endpoints don't over-burn.
 *
 * Reference math (public domain):
 *   v² = u² + 2·a·s    (kinematic equation)
 *   t = (v - u) / a     (velocity from accel over time)
 *
 * See GRBL planner documentation at github.com/gnea/grbl/wiki for
 * discussion of trapezoidal profiles in a real motion planner.
 *
 * This module is independent of Smoothieware and implements the same
 * concept (velocity-proportional PWM) at G-code generation time rather
 * than firmware runtime. No Smoothieware code was examined or copied.
 */

export interface MoveKinematics {
  /** Total move distance, mm. */
  distanceMm: number;
  /** Commanded feedrate, mm/min. */
  feedrateMmPerMin: number;
  /** Entry velocity at start of move, mm/min. Usually 0 or junction velocity. */
  entryVelocityMmPerMin: number;
  /** Exit velocity at end of move, mm/min. Usually 0 or next junction velocity. */
  exitVelocityMmPerMin: number;
  /** Machine max acceleration, mm/s². */
  maxAccelMmPerS2: number;
}

export interface VelocityZones {
  /** Distance from move start where accel phase ends. */
  accelEndMm: number;
  /** Distance from move start where decel phase begins. */
  decelStartMm: number;
  /** Peak velocity reached (may be less than commanded if move is short). */
  peakVelocityMmPerMin: number;
  /** True if the move is too short to reach commanded feedrate. */
  isTriangular: boolean;
}

/**
 * Compute the three zones of a trapezoidal (or triangular) velocity profile.
 */
export function computeVelocityZones(k: MoveKinematics): VelocityZones {
  const distMm = Math.max(0, k.distanceMm);
  const feedMmPerMin = Math.max(1, k.feedrateMmPerMin);
  const feedMmPerS = feedMmPerMin / 60;
  const entryMmPerS = k.entryVelocityMmPerMin / 60;
  const exitMmPerS = k.exitVelocityMmPerMin / 60;
  const accel = Math.max(1, k.maxAccelMmPerS2);

  const accelDist = (feedMmPerS * feedMmPerS - entryMmPerS * entryMmPerS) / (2 * accel);
  const decelDist = (feedMmPerS * feedMmPerS - exitMmPerS * exitMmPerS) / (2 * accel);

  if (accelDist + decelDist <= distMm) {
    return {
      accelEndMm: Math.max(0, accelDist),
      decelStartMm: distMm - Math.max(0, decelDist),
      peakVelocityMmPerMin: feedMmPerMin,
      isTriangular: false,
    };
  }

  const vpSquared = accel * distMm + (entryMmPerS * entryMmPerS + exitMmPerS * exitMmPerS) / 2;
  const peakMmPerS = Math.sqrt(Math.max(0, vpSquared));
  const actualAccelDist = (peakMmPerS * peakMmPerS - entryMmPerS * entryMmPerS) / (2 * accel);

  return {
    accelEndMm: Math.max(0, Math.min(distMm, actualAccelDist)),
    decelStartMm: Math.max(0, Math.min(distMm, actualAccelDist)),
    peakVelocityMmPerMin: peakMmPerS * 60,
    isTriangular: true,
  };
}

/**
 * Instantaneous velocity at position `posMm` along a move with the given
 * velocity zones. Returns mm/min.
 */
export function velocityAt(
  posMm: number,
  k: MoveKinematics,
  zones: VelocityZones,
): number {
  const accel = Math.max(1, k.maxAccelMmPerS2);
  const entryMmPerS = k.entryVelocityMmPerMin / 60;
  const peakMmPerS = zones.peakVelocityMmPerMin / 60;
  const clampedPos = Math.max(0, Math.min(k.distanceMm, posMm));

  if (clampedPos <= zones.accelEndMm) {
    const vSquared = entryMmPerS * entryMmPerS + 2 * accel * clampedPos;
    return Math.sqrt(Math.max(0, vSquared)) * 60;
  }

  if (clampedPos >= zones.decelStartMm) {
    const distIntoDecel = clampedPos - zones.decelStartMm;
    const vSquared = peakMmPerS * peakMmPerS - 2 * accel * distIntoDecel;
    return Math.sqrt(Math.max(0, vSquared)) * 60;
  }

  return zones.peakVelocityMmPerMin;
}

/**
 * Scale laser power by velocity ratio. Returns a value in [0, commandedPower].
 */
export function scalePowerByVelocity(
  commandedPower: number,
  currentVel: number,
  targetVel: number,
  floorRatio: number = 0.1,
): number {
  if (targetVel <= 0) return commandedPower;
  const ratio = Math.max(floorRatio, Math.min(1, currentVel / targetVel));
  return Math.round(commandedPower * ratio);
}
