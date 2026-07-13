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
  type FillGroup,
  type FillSegment,
  type Job,
  type RasterGroup,
} from './job';
import { estimateWithPlanner } from './planner';

export type JobDurationEstimate = {
  readonly totalSeconds: number;
  readonly breakdown: {
    readonly cutSeconds: number;
    readonly travelSeconds: number;
  };
};

const PIXEL_CENTER_OFFSET = 0.5;
const SWEEP_DIRECTION_PERIOD = 2;
const RASTER_GAP_RAPID_THRESHOLD_MM = 5;

export function estimateJobDuration(job: Job, device: DeviceProfile): JobDurationEstimate {
  const plannerJob = jobWithCncAsCutGroups(jobWithRasterSweeps(job));
  const estimate = estimateWithPlanner(plannerJob, device);
  const plungeSeconds = cncPlungeSeconds(job, device);
  const cutSeconds =
    (estimate.breakdown.cutSeconds + plungeSeconds) * timingScale(device.estimateCutTimeScale);
  const travelSeconds =
    estimate.breakdown.travelSeconds * timingScale(device.estimateTravelTimeScale);
  return {
    totalSeconds: cutSeconds + travelSeconds,
    breakdown: {
      cutSeconds,
      travelSeconds,
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

function jobWithRasterSweeps(job: Job): Job {
  let changed = false;
  const groups = job.groups.map((group) => {
    if (group.kind !== 'raster') return group;
    changed = true;
    return rasterAsFillSweepGroup(group);
  });
  return changed ? { groups } : job;
}

function rasterAsFillSweepGroup(group: RasterGroup): FillGroup {
  return {
    kind: 'fill',
    layerId: group.layerId,
    color: group.color,
    power: group.power,
    speed: group.speed,
    passes: group.passes,
    airAssist: group.airAssist,
    overscanMm: group.overscanMm,
    segments: rasterActiveSweepSegments(group),
  };
}

function rasterActiveSweepSegments(group: RasterGroup): FillGroup['segments'] {
  if (group.pixelWidth <= 0 || group.pixelHeight <= 0) return [];
  const pixelWidthMm = (group.bounds.maxX - group.bounds.minX) / group.pixelWidth;
  const pixelHeightMm = (group.bounds.maxY - group.bounds.minY) / group.pixelHeight;
  if (pixelWidthMm <= 0 || pixelHeightMm <= 0) return [];

  const segments: FillSegment[] = [];
  let sweepIndex = 0;
  for (let y = 0; y < group.pixelHeight; y += 1) {
    const spans = rasterActiveSpans(group, y, pixelWidthMm);
    if (spans.length === 0) continue;
    const worldY = group.bounds.minY + (y + PIXEL_CENTER_OFFSET) * pixelHeightMm;
    const isReverseSweep = sweepIndex % SWEEP_DIRECTION_PERIOD === 1;
    for (const span of spans) {
      const startX = group.bounds.minX + span.firstX * pixelWidthMm;
      const endX = group.bounds.minX + (span.lastX + 1) * pixelWidthMm;
      segments.push({
        polyline: isReverseSweep
          ? [
              { x: endX, y: worldY },
              { x: startX, y: worldY },
            ]
          : [
              { x: startX, y: worldY },
              { x: endX, y: worldY },
            ],
        closed: false,
        reverse: isReverseSweep,
      });
    }
    sweepIndex += 1;
  }
  return segments;
}

type RasterSpan = { readonly firstX: number; readonly lastX: number };

function rasterActiveSpans(
  group: RasterGroup,
  y: number,
  pixelWidthMm: number,
): ReadonlyArray<RasterSpan> {
  const rowStart = y * group.pixelWidth;
  const spans: RasterSpan[] = [];
  let firstX = -1;
  for (let x = 0; x < group.pixelWidth; x += 1) {
    if ((group.sValues[rowStart + x] ?? 0) > 0) {
      firstX = x;
      break;
    }
  }
  if (firstX === -1) return spans;
  let lastInk = firstX;
  for (let x = firstX + 1; x < group.pixelWidth; x += 1) {
    if ((group.sValues[rowStart + x] ?? 0) <= 0) continue;
    const gapMm = (x - lastInk - 1) * pixelWidthMm;
    if (gapMm > RASTER_GAP_RAPID_THRESHOLD_MM) {
      spans.push({ firstX, lastX: lastInk });
      firstX = x;
    }
    lastInk = x;
  }
  spans.push({ firstX, lastX: lastInk });
  return spans;
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
