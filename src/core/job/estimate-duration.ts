// estimateJobDuration — predict how long a Job will take to burn.
//
// L2 (planner-aware). Delegates to src/core/job/planner.ts which runs
// Sonny Jeon's grbl-style motion planner:
//
//   1. Decompose the Job into one Block per polyline edge (a 100-vertex
//      curve becomes 100 blocks — not one). This is the change that
//      closes the L1 estimator's biggest blind spot: real GRBL slows
//      at every direction change, and the old "treat the whole
//      polyline as one move" lie was costing 2-3× accuracy on
//      detail-heavy work.
//   2. Junction-deviation rule sets a per-junction velocity cap from
//      $11 (DeviceProfile.junctionDeviationMm) and the angle between
//      adjacent blocks.
//   3. Two-pass lookahead (backward + forward) assigns compatible
//      entry/exit velocities per block.
//   4. Generalized trapezoidal time per block: accel from v_entry up
//      to v_peak, optional cruise at v_peak, decel to v_exit.
//
// Public API unchanged — JobControls and any other caller still get
// the same { totalSeconds, breakdown } shape.
//
// Pure-core compliant: no clock reads, no Math.random, no I/O.

import type { DeviceProfile } from '../devices';
import type { Job } from './job';
import { estimateWithPlanner } from './planner';

export type JobDurationEstimate = {
  readonly totalSeconds: number;
  readonly breakdown: {
    readonly cutSeconds: number;
    readonly travelSeconds: number;
  };
};

export function estimateJobDuration(job: Job, device: DeviceProfile): JobDurationEstimate {
  return estimateWithPlanner(job, device);
}

// Human-readable formatter — "4m 23s" / "47s" / "1h 12m". Co-located with
// the estimate so callers don't reinvent the math; reused by JobControls
// and any future status display.
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.round(safe % 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
