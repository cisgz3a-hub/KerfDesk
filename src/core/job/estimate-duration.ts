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
import {
  type CncGroup,
  type CncPath3dPass,
  type CutGroup,
  type CutSegment,
  type Group,
  type Job,
} from './job';
import { estimateWithPlanner, type PlannerEndMotionOptions } from './planner';
import { cncDurationOverhead } from './cnc-duration-overhead';
import { cncSpindleTransition } from '../cnc/spindle-transition';

export type JobDurationBreakdown = {
  readonly cutSeconds: number;
  readonly travelSeconds: number;
  // Optional keeps older callers/fixtures source-compatible. KerfDesk's live
  // estimator always provides both details so Preview can distinguish G0 from
  // laser-off G1 motion while Job Review retains the aggregate travel total.
  readonly rapidTravelSeconds?: number;
  readonly feedTravelSeconds?: number;
  /** Fixed emitted G4 timing; cut/travel calibration never scales this. */
  readonly dwellSeconds?: number;
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
  const estimate = estimateWithPlanner(plannerJob, plannerMotionDevice(job, device), options);
  const { plungeSeconds, retractSeconds, dwellSeconds } = cncDurationOverhead(job, device);
  const cutSeconds =
    (estimate.breakdown.cutSeconds + plungeSeconds) * timingScale(device.estimateCutTimeScale);
  const travelScale = timingScale(device.estimateTravelTimeScale);
  const rapidTravelSeconds = (estimate.breakdown.rapidTravelSeconds + retractSeconds) * travelScale;
  const feedTravelSeconds = estimate.breakdown.feedTravelSeconds * travelScale;
  const travelSeconds = rapidTravelSeconds + feedTravelSeconds;
  return {
    totalSeconds: cutSeconds + travelSeconds + dwellSeconds,
    breakdown: {
      cutSeconds,
      travelSeconds,
      rapidTravelSeconds,
      feedTravelSeconds,
      dwellSeconds,
    },
  };
}

function timingScale(value: number | undefined): number {
  return isEstimateTimeScale(value) ? value : 1;
}

function plannerMotionDevice(job: Job, device: DeviceProfile): DeviceProfile {
  if (!job.groups.some((group) => group.kind === 'cnc')) return device;
  // The CNC emitter always uses G0 for XY seeks and parking. A retained laser
  // profile preference must not turn its travel into a controlled laser G1.
  const { controlledLaserOffTravelFeedMmPerMin: laserSeek, ...cncDevice } = device;
  void laserSeek;
  return cncDevice;
}

// Ordinary CNC paths retain the legacy XY planner plus analytic entry/retract
// terms. Z-rate-capped V-carve paths additionally carry each emitted XYZ edge
// into the planner so their 3D length, junction angle, and capped feed agree
// with the generated program.
function jobWithCncAsCutGroups(job: Job): Job {
  let changed = false;
  let previousCncGroup: CncGroup | undefined;
  const groups: Group[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cnc') {
      groups.push(group);
      continue;
    }
    changed = true;
    const projection = cncAsCutGroups(group);
    groups.push(...withCncSpindleStop(projection, previousCncGroup, group));
    previousCncGroup = group;
  }
  return changed ? { groups } : job;
}

function withCncSpindleStop(
  projection: ReadonlyArray<CutGroup>,
  previous: CncGroup | undefined,
  group: CncGroup,
): ReadonlyArray<CutGroup> {
  if (previous === undefined) return projection;
  const transition = cncSpindleTransition(group, {
    // Distinct adjacent tool keys necessarily imply a multi-tool program.
    isMultiTool: true,
    currentToolKey: previous.toolId ?? '',
    currentRpm: previous.spindleRpm,
  });
  if (transition === 'none') return projection;
  const changedS =
    Math.max(0, Math.round(previous.spindleRpm)) !== Math.max(0, Math.round(group.spindleRpm));
  if (transition !== 'tool-change' && !(group.spindleSpinupSec > 0) && !changedS) return projection;
  return projection.map(
    (cut, index): CutGroup => (index === 0 ? { ...cut, plannerStopBefore: true } : cut),
  );
}

function cncAsCutGroups(group: CncGroup): ReadonlyArray<CutGroup> {
  const hasZRateCappedPath = group.passes.some(
    (pass) => pass.kind === 'path3d' && pass.lateralFeed === 'z-rate-capped',
  );
  const hasPlungeFedPath = group.passes.some(
    (pass) => pass.kind === 'path3d' && pass.lateralFeed === 'plunge',
  );
  // Pecks (including interpolated registration-bore centres) have zero XY
  // length. Their XYZ projection must price plunge and chip-clear moves.
  const hasVerticalPath = group.passes.some(isVerticalPath3d);
  if (!hasPlungeFedPath && !hasZRateCappedPath && !hasVerticalPath) {
    return [cncAsCutGroup(group, group.passes, group.feedMmPerMin)];
  }
  return group.passes.flatMap((pass) => {
    if (
      pass.kind === 'path3d' &&
      (pass.lateralFeed === 'z-rate-capped' || isVerticalPath3d(pass))
    ) {
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

function isVerticalPath3d(pass: CncGroup['passes'][number]): boolean {
  if (pass.kind !== 'path3d') return false;
  const first = pass.points[0];
  return (
    first !== undefined && pass.points.every((point) => point.x === first.x && point.y === first.y)
  );
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
      plannerCoordinatesRepresented: true,
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

// Human-readable formatter — "4m 23s" / "47s" / "1h 12m 12s". Co-located with
// the estimate so callers don't reinvent the math; reused by JobControls
// and any future status display.
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.round(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
