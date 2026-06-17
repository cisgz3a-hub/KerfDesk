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
import type { FillGroup, FillSegment, Job, RasterGroup } from './job';
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

export function estimateJobDuration(job: Job, device: DeviceProfile): JobDurationEstimate {
  return estimateWithPlanner(jobWithRasterSweeps(job), device);
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
    const span = rasterActiveSpan(group, y);
    if (span === null) continue;
    const worldY = group.bounds.minY + (y + PIXEL_CENTER_OFFSET) * pixelHeightMm;
    const startX = group.bounds.minX + span.firstX * pixelWidthMm;
    const endX = group.bounds.minX + (span.lastX + 1) * pixelWidthMm;
    const isReverseSweep = sweepIndex % SWEEP_DIRECTION_PERIOD === 1;
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
    sweepIndex += 1;
  }
  return segments;
}

type RasterSpan = { readonly firstX: number; readonly lastX: number };

function rasterActiveSpan(group: RasterGroup, y: number): RasterSpan | null {
  const rowStart = y * group.pixelWidth;
  let firstX = -1;
  for (let x = 0; x < group.pixelWidth; x += 1) {
    if ((group.sValues[rowStart + x] ?? 0) !== 0) {
      firstX = x;
      break;
    }
  }
  if (firstX === -1) return null;
  let lastX = group.pixelWidth - 1;
  for (let x = group.pixelWidth - 1; x >= firstX; x -= 1) {
    if ((group.sValues[rowStart + x] ?? 0) !== 0) {
      lastX = x;
      break;
    }
  }
  return { firstX, lastX };
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
