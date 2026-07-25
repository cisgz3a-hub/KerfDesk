// Generalized trapezoidal block time (extracted from core/job/planner.ts,
// ADR-255 stage 8a — pure move, no behavior change).

import type { Block } from './block';

// Generalized trapezoidal time from v_entry through optional v_peak
// to v_exit over a given distance, capped at v_target.
export function blockTime(block: Block, entryV: number, exitV: number, accel: number): number {
  const d = block.distance;
  if (d <= 0) return 0;
  const vTarget = block.targetVelocity;
  // Distance needed to accel from entryV to vTarget then decel to exitV.
  const dAccel = Math.max(0, (vTarget * vTarget - entryV * entryV) / (2 * accel));
  const dDecel = Math.max(0, (vTarget * vTarget - exitV * exitV) / (2 * accel));
  if (dAccel + dDecel <= d) {
    // Trapezoid: hits vTarget, optional cruise.
    const tAccel = (vTarget - entryV) / accel;
    const tDecel = (vTarget - exitV) / accel;
    const tCruise = (d - dAccel - dDecel) / vTarget;
    return tAccel + tCruise + tDecel;
  }
  // Triangle: never reaches vTarget. Find the peak velocity v_peak that
  // satisfies: dAccel(entry→peak) + dDecel(peak→exit) = d.
  // Solving: v_peak² = (entry² + exit²)/2 + a·d
  const vPeakSq = (entryV * entryV + exitV * exitV) / 2 + accel * d;
  const vPeak = Math.sqrt(Math.max(0, vPeakSq));
  // If the math says peak < max(entry, exit), the move is decel-only
  // or accel-only — entry and exit can't both be satisfied at this
  // distance with this accel. Fall back to the constraining single-
  // phase time (no cruise, no triangle).
  if (vPeak <= Math.max(entryV, exitV)) {
    // Pure accel (entry < exit) or pure decel (entry > exit) over d.
    // Time = 2d / (entry + exit) if entry+exit > 0; else accel-from-rest.
    const sum = entryV + exitV;
    if (sum > 0) return (2 * d) / sum;
    return Math.sqrt((2 * d) / accel);
  }
  const tAccel = (vPeak - entryV) / accel;
  const tDecel = (vPeak - exitV) / accel;
  return tAccel + tDecel;
}
