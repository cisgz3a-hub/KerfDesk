// Generalized trapezoidal block time (extracted from core/job/planner.ts,
// ADR-255 stage 8a — pure move, no behavior change).

import type { Block } from './block';

type BlockElapsedTimeAtDistanceInput = {
  readonly block: Pick<Block, 'distance' | 'targetVelocity'>;
  readonly entryVelocity: number;
  readonly exitVelocity: number;
  readonly acceleration: number;
  readonly distance: number;
};

type SinglePhaseElapsedTimeInput = {
  readonly entryVelocity: number;
  readonly exitVelocity: number;
  readonly acceleration: number;
  readonly totalDistance: number;
  readonly distance: number;
};

// Generalized trapezoidal time from v_entry through optional v_peak
// to v_exit over a given distance, capped at v_target.
export function blockTime(block: Block, entryV: number, exitV: number, accel: number): number {
  return blockElapsedTimeAtDistance({
    block,
    entryVelocity: entryV,
    exitVelocity: exitV,
    acceleration: accel,
    distance: block.distance,
  });
}

/** Elapsed planner time after travelling `distance` through one planned block. */
export function blockElapsedTimeAtDistance(input: BlockElapsedTimeAtDistanceInput): number {
  const {
    block,
    entryVelocity: entryV,
    exitVelocity: exitV,
    acceleration: accel,
    distance,
  } = input;
  const d = block.distance;
  if (d <= 0) return 0;
  const x = Math.max(0, Math.min(distance, d));
  if (x <= 0) return 0;
  const a = Math.max(Number.EPSILON, accel);
  const vTarget = block.targetVelocity;
  // Distance needed to accel from entryV to vTarget then decel to exitV.
  const dAccel = Math.max(0, (vTarget * vTarget - entryV * entryV) / (2 * a));
  const dDecel = Math.max(0, (vTarget * vTarget - exitV * exitV) / (2 * a));
  if (dAccel + dDecel <= d) {
    // Trapezoid: hits vTarget, optional cruise.
    const dCruise = d - dAccel - dDecel;
    const tAccel = (vTarget - entryV) / a;
    if (x <= dAccel) return accelerationTime(entryV, a, x);
    if (x <= dAccel + dCruise) {
      return tAccel + (x - dAccel) / vTarget;
    }
    return tAccel + dCruise / vTarget + decelerationTime(vTarget, a, x - dAccel - dCruise);
  }
  // Triangle: never reaches vTarget. Find the peak velocity v_peak that
  // satisfies: dAccel(entry→peak) + dDecel(peak→exit) = d.
  // Solving: v_peak² = (entry² + exit²)/2 + a·d
  const vPeakSq = (entryV * entryV + exitV * exitV) / 2 + a * d;
  const vPeak = Math.sqrt(Math.max(0, vPeakSq));
  // If the math says peak < max(entry, exit), the move is decel-only
  // or accel-only — entry and exit can't both be satisfied at this
  // distance with this accel. Fall back to the constraining single-
  // phase time (no cruise, no triangle).
  if (vPeak <= Math.max(entryV, exitV)) {
    return singlePhaseElapsedTime({
      entryVelocity: entryV,
      exitVelocity: exitV,
      acceleration: a,
      totalDistance: d,
      distance: x,
    });
  }
  const peakDistance = Math.max(0, (vPeak * vPeak - entryV * entryV) / (2 * a));
  const tAccel = (vPeak - entryV) / a;
  return x <= peakDistance
    ? accelerationTime(entryV, a, x)
    : tAccel + decelerationTime(vPeak, a, x - peakDistance);
}

function accelerationTime(initialVelocity: number, accel: number, distance: number): number {
  return (
    (Math.sqrt(Math.max(0, initialVelocity * initialVelocity + 2 * accel * distance)) -
      initialVelocity) /
    accel
  );
}

function decelerationTime(initialVelocity: number, accel: number, distance: number): number {
  return (
    (initialVelocity -
      Math.sqrt(Math.max(0, initialVelocity * initialVelocity - 2 * accel * distance))) /
    accel
  );
}

function singlePhaseElapsedTime(input: SinglePhaseElapsedTimeInput): number {
  const {
    entryVelocity: entryV,
    exitVelocity: exitV,
    acceleration: accel,
    totalDistance,
    distance,
  } = input;
  const effectiveAcceleration =
    totalDistance <= 0 ? 0 : (exitV * exitV - entryV * entryV) / (2 * totalDistance);
  if (Math.abs(effectiveAcceleration) <= Number.EPSILON) {
    const velocity = Math.max(entryV, exitV);
    return velocity > 0 ? distance / velocity : Math.sqrt((2 * distance) / accel);
  }
  const velocitySquared = entryV * entryV + 2 * effectiveAcceleration * distance;
  return (Math.sqrt(Math.max(0, velocitySquared)) - entryV) / effectiveAcceleration;
}
