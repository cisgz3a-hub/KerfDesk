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
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';
import { cncPassRepresentedXyPoints } from '../cnc/cnc-pass-representation';
import {
  formatCncCoordinateMm,
  representedCncCoordinateMm,
} from '../cnc/coordinate-representation';
import { cncPassCanEmit } from '../cnc/output-representation';
import {
  cncPassEntryDepthMm,
  type CncGroup,
  type CncPath3dPass,
  type CutGroup,
  type CutSegment,
  type Group,
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

// Ordinary CNC paths retain the legacy XY planner plus analytic entry/retract
// terms. Z-rate-capped V-carve paths additionally carry each emitted XYZ edge
// into the planner so their 3D length, junction angle, and capped feed agree
// with the generated program.
function jobWithCncAsCutGroups(job: Job): Job {
  let changed = false;
  const groups: Group[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') {
      groups.push(group);
      continue;
    }
    changed = true;
    groups.push(...cncAsCutGroups(group));
  }
  return changed ? { groups } : job;
}

function cncAsCutGroups(group: CncGroup): ReadonlyArray<CutGroup> {
  const hasZRateCappedPath = group.passes.some(
    (pass) => pass.kind === 'path3d' && pass.lateralFeed === 'z-rate-capped',
  );
  const hasPlungeFedPath = group.passes.some(
    (pass) => pass.kind === 'path3d' && pass.lateralFeed === 'plunge',
  );
  if (!hasPlungeFedPath && !hasZRateCappedPath) {
    return [cncAsCutGroup(group, group.passes, group.feedMmPerMin)];
  }
  return group.passes.flatMap((pass) => {
    if (pass.kind === 'path3d' && pass.lateralFeed === 'z-rate-capped') {
      return zRateCappedPathAsCutGroups(group, pass);
    }
    return [
      cncAsCutGroup(
        group,
        [pass],
        pass.kind === 'path3d' && pass.lateralFeed === 'plunge'
          ? group.plungeMmPerMin
          : group.feedMmPerMin,
      ),
    ];
  });
}

function zRateCappedPathAsCutGroups(group: CncGroup, pass: CncPath3dPass): ReadonlyArray<CutGroup> {
  if (pass.points.length < 2) return [cncAsCutGroup(group, [pass], group.feedMmPerMin)];
  const groups: CutGroup[] = [];
  for (let index = 1; index < pass.points.length; index += 1) {
    const from = pass.points[index - 1];
    const to = pass.points[index];
    if (from === undefined || to === undefined) continue;
    const representedFrom = representedPath3dPoint(from);
    const representedTo = representedPath3dPoint(to);
    groups.push(
      cncAsCutGroup(
        group,
        [{ ...pass, points: [from, to], closed: false }],
        zRateCappedSegmentFeed(group, from, to),
        plannerMotion(representedFrom, representedTo),
      ),
    );
  }
  return groups;
}

function zRateCappedSegmentFeed(
  group: CncGroup,
  from: CncPath3dPass['points'][number],
  to: CncPath3dPass['points'][number],
): number {
  const emittedFrom = emittedPath3dPoint(from);
  const emittedTo = emittedPath3dPoint(to);
  const feed = emittedCncFeedMmPerMin(group.feedMmPerMin);
  const plunge = emittedCncFeedMmPerMin(group.plungeMmPerMin);
  // Match the emitter's same-XY rule: a pure vertical in-cut move uses plunge
  // feed in either direction, while a lateral rise keeps cutting feed.
  if (
    emittedTo.x.text === emittedFrom.x.text &&
    emittedTo.y.text === emittedFrom.y.text &&
    emittedTo.z.text !== emittedFrom.z.text
  ) {
    return plunge;
  }
  const descentMm = emittedFrom.z.value - emittedTo.z.value;
  if (!(descentMm > 0) || !Number.isFinite(descentMm)) return feed;
  const length3d = Math.hypot(
    emittedTo.x.value - emittedFrom.x.value,
    emittedTo.y.value - emittedFrom.y.value,
    descentMm,
  );
  if (!(length3d > 0) || !Number.isFinite(length3d)) return feed;
  const plungeLimitedFeed = effectiveGcodeFeedMmPerMin((plunge * length3d) / descentMm);
  return Math.min(feed, plungeLimitedFeed);
}

function emittedCncFeedMmPerMin(value: number): number {
  return effectiveGcodeFeedMmPerMin(value);
}

function emittedPath3dPoint(point: CncPath3dPass['points'][number]): {
  readonly x: { readonly text: string; readonly value: number };
  readonly y: { readonly text: string; readonly value: number };
  readonly z: { readonly text: string; readonly value: number };
} {
  return {
    x: emittedCoordinate(point.x),
    y: emittedCoordinate(point.y),
    z: emittedCoordinate(point.z),
  };
}

function emittedCoordinate(value: number): { readonly text: string; readonly value: number } {
  const text = formatCncCoordinateMm(value);
  return { text, value: Number(text) };
}

function representedPath3dPoint(
  point: CncPath3dPass['points'][number],
): CncPath3dPass['points'][number] {
  return {
    x: representedCncCoordinateMm(point.x),
    y: representedCncCoordinateMm(point.y),
    z: representedCncCoordinateMm(point.z),
  };
}

function cncAsCutGroup(
  group: CncGroup,
  passes: CncGroup['passes'],
  speed: number,
  motion?: NonNullable<CutSegment['plannerMotion']>,
): CutGroup {
  return {
    kind: 'cut',
    layerId: group.layerId,
    color: group.color,
    power: 100,
    speed,
    passes: 1,
    airAssist: false,
    segments: passes.map((pass, index) => ({
      polyline: cncPassRepresentedXyPoints(pass),
      closed: pass.closed,
      ...(index === 0 && motion !== undefined ? { plannerMotion: motion } : {}),
    })),
  };
}

function plannerMotion(
  from: CncPath3dPass['points'][number],
  to: CncPath3dPass['points'][number],
): NonNullable<CutSegment['plannerMotion']> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const distanceMm = Math.hypot(dx, dy, dz);
  return {
    distanceMm,
    direction:
      distanceMm > 0
        ? { x: dx / distanceMm, y: dy / distanceMm, z: dz / distanceMm }
        : { x: 0, y: 0, z: 0 },
  };
}

const SECONDS_PER_MINUTE = 60;

function cncPlungeSeconds(job: Job, device: DeviceProfile): number {
  let seconds = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc') continue;
    const plungeFeed = emittedCncFeedMmPerMin(group.plungeMmPerMin);
    const retractFeed = Math.max(1, device.maxFeed);
    const safeZMm = representedCncCoordinateMm(Math.max(0, group.safeZMm));
    for (const pass of group.passes) {
      if (!cncPassCanEmit(pass)) continue;
      const travelZMm = safeZMm + Math.abs(cncPassEntryDepthMm(pass));
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
