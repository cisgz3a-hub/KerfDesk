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

import { isEstimateTimeScale, type DeviceProfile } from '../devices';
import {
  cncPassEntryDepthMm,
  cncPassXyPoints,
  type CncGroup,
  type CutGroup,
  type Job,
} from './job';
import { estimateWithPlanner, type PlannerEndMotionOptions } from './planner';

export type JobDurationBreakdown = {
  readonly cutSeconds: number;
  readonly travelSeconds: number;
  // Optional keeps older callers/fixtures source-compatible. KerfDesk's live
  // estimator always provides both details so Preview can distinguish G0 from
  // laser-off G1 motion while Job Review retains the aggregate travel total.
  readonly rapidTravelSeconds?: number;
  readonly feedTravelSeconds?: number;
};

export type JobDurationEstimate = {
  readonly totalSeconds: number;
  readonly breakdown: JobDurationBreakdown;
};

export type JobDurationEstimateOptions = PlannerEndMotionOptions;

export function estimateJobDuration(
  job: Job,
  device: DeviceProfile,
  options: JobDurationEstimateOptions = {},
): JobDurationEstimate {
  const plannerJob = jobWithCncAsCutGroups(job);
  const estimate = estimateWithPlanner(plannerJob, device, options);
  const plungeSeconds = cncPlungeSeconds(job, device);
  const cutSeconds =
    (estimate.breakdown.cutSeconds + plungeSeconds) * timingScale(device.estimateCutTimeScale);
  const travelScale = timingScale(device.estimateTravelTimeScale);
  const rapidTravelSeconds = estimate.breakdown.rapidTravelSeconds * travelScale;
  const feedTravelSeconds = estimate.breakdown.feedTravelSeconds * travelScale;
  const travelSeconds = rapidTravelSeconds + feedTravelSeconds;
  return {
    totalSeconds: cutSeconds + travelSeconds,
    breakdown: {
      cutSeconds,
      travelSeconds,
      rapidTravelSeconds,
      feedTravelSeconds,
    },
  };
}

function timingScale(value: number | undefined): number {
  return isEstimateTimeScale(value) ? value : 1;
}

// The XY planner knows nothing about Z. CNC groups estimate as cut groups at
// the XY feed, plus an analytic term for plunges (at plunge feed) and
// retracts (approximated at the machine's max feed) per pass.
function jobWithCncAsCutGroups(job: Job): Job {
  let changed = false;
  const groups = job.groups.map((group) => {
    if (group.kind !== 'cnc') return group;
    changed = true;
    return cncAsCutGroup(group);
  });
  return changed ? { groups } : job;
}

function cncAsCutGroup(group: CncGroup): CutGroup {
  return {
    kind: 'cut',
    layerId: group.layerId,
    color: group.color,
    power: 100,
    speed: group.feedMmPerMin,
    passes: 1,
    airAssist: false,
    // path3d passes project to XY here; their Z travel is approximated by the
    // plunge term below (exact 3D length arrives with the H.2 simulator).
    segments: group.passes.map((pass) => ({
      polyline: cncPassXyPoints(pass),
      closed: pass.closed,
    })),
  };
}

const SECONDS_PER_MINUTE = 60;

function cncPlungeSeconds(job: Job, device: DeviceProfile): number {
  let seconds = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const plungeFeed = Math.max(1, group.plungeMmPerMin);
    const retractFeed = Math.max(1, device.maxFeed);
    for (const pass of group.passes) {
      const travelZMm = group.safeZMm + Math.abs(cncPassEntryDepthMm(pass));
      seconds += (travelZMm / plungeFeed) * SECONDS_PER_MINUTE;
      seconds += (travelZMm / retractFeed) * SECONDS_PER_MINUTE;
    }
  }
  return seconds;
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
