// Tangential feed-matched entry runways for contour starts on the 4040-safe
// profile (ADR-239). ADR-234 gave scanline fill sweeps a bounded laser-off
// `G1 S0` entry at burn feed, but Line-mode contours and Follow Shape
// (offset) fill loops still opened with power on the first move out of the
// seek junction — the same start-from-low-speed mechanism behind the 4040
// uneven-lettering burn. The entry runs collinear with the contour's first
// burn edge so GRBL's junction planner carries the entry feed straight into
// the ink instead of stopping at the junction.

import { machineBoundsForDevice, type DeviceProfile } from '../devices';
import type { Vec2 } from '../scene';
import type { Job } from './job';
import type { JobBounds } from './job-bounds';
import { fillRunwayPolicyForDevice } from './fill-runway-policy';
import { feedMatchedFillRunwayMm } from './fill-sweep-plan';

// An edge shorter than the emitter's 3-decimal coordinate resolution cannot
// define a tangent direction; skip it and derive the entry direction from
// the first materially distinct vertex instead.
const MIN_TANGENT_EDGE_MM = 0.001;

/**
 * Entry-runway length (mm) contour starts receive on this device, or
 * undefined where contours keep their legacy byte-identical emission.
 * Rides the same device policy switch as ADR-234's scanline fill entries
 * (the 4040-safe dialect) and uses the same length formula
 * `min(max(0, overscan), 5)`, so overscan 0 disables it — the same
 * explicit operator choice ADR-236 has Job Review report for fill.
 */
export function contourEntryRunwayMm(
  device: DeviceProfile,
  overscanMm: number,
): number | undefined {
  if (fillRunwayPolicyForDevice(device) === undefined) return undefined;
  const runwayMm = feedMatchedFillRunwayMm(overscanMm);
  return runwayMm > 0 ? runwayMm : undefined;
}

// Compatibility input for archived jobs that predate explicit program bounds.
export type BedSizeMm = {
  readonly widthMm: number;
  readonly heightMm: number;
};

export type ContourEntryBounds = JobBounds | BedSizeMm | null | undefined;

export function contourEntryBoundsForDevice(device: DeviceProfile): JobBounds {
  const { minX, minY, maxX, maxY } = machineBoundsForDevice(device);
  return { minX, minY, maxX, maxY };
}

/** Only entry-bearing jobs need this metadata. Null means the physical bed's
 * position in program coordinates is unknown, so optional entries are omitted. */
export function withContourEntryBounds(job: Job, bounds: JobBounds | null): Job {
  return job.groups.some(
    (group) => (group.kind === 'cut' || group.kind === 'fill') && (group.entryRunwayMm ?? 0) > 0,
  )
    ? { ...job, contourEntryBounds: bounds }
    : job;
}

/**
 * Where the laser-off entry begins for one contour: the first vertex moved
 * back `leadMm` along the direction of the first non-degenerate edge. With a
 * bed provided, the lead shrinks to the room available before the boundary —
 * the ADR-234 "bounded" treatment applied to the bed edge instead of a
 * neighboring sweep's gap. Null when no edge defines a direction (single
 * point or a contour that fully collapses at emit precision) or when no room
 * remains — such contours keep their legacy approach.
 */
export function contourEntryPoint(
  polyline: ReadonlyArray<Vec2>,
  leadMm: number,
  bed?: ContourEntryBounds,
): Vec2 | null {
  const first = polyline[0];
  if (first === undefined || leadMm <= 0 || bed === null) return null;
  for (let i = 1; i < polyline.length; i += 1) {
    const pt = polyline[i];
    if (pt === undefined) continue;
    const dx = pt.x - first.x;
    const dy = pt.y - first.y;
    const edgeMm = Math.hypot(dx, dy);
    if (edgeMm < MIN_TANGENT_EDGE_MM) continue;
    const backX = -dx / edgeMm;
    const backY = -dy / edgeMm;
    const boundedMm =
      bed === undefined ? leadMm : bedBoundedLeadMm(first, backX, backY, leadMm, bed);
    if (boundedMm < MIN_TANGENT_EDGE_MM) return null;
    return { x: first.x + backX * boundedMm, y: first.y + backY * boundedMm };
  }
  return null;
}

// Room from `from` along the unit back-off direction before leaving the bed,
// capped at leadMm. A start already outside the bed yields 0 (no entry) and
// leaves the job to the existing out-of-bed preflight reporting.
function bedBoundedLeadMm(
  from: Vec2,
  backX: number,
  backY: number,
  leadMm: number,
  bed: JobBounds | BedSizeMm,
): number {
  const bounds = 'minX' in bed ? bed : { minX: 0, minY: 0, maxX: bed.widthMm, maxY: bed.heightMm };
  // The explicit envelope contract never invents travel for an outside start.
  // Legacy size-only input retains archived output, including its old clamp.
  if ('minX' in bed && !insideBounds(from, bounds)) return 0;
  let roomMm = leadMm;
  if (backX > 0) roomMm = Math.min(roomMm, (bounds.maxX - from.x) / backX);
  else if (backX < 0) roomMm = Math.min(roomMm, (from.x - bounds.minX) / -backX);
  if (backY > 0) roomMm = Math.min(roomMm, (bounds.maxY - from.y) / backY);
  else if (backY < 0) roomMm = Math.min(roomMm, (from.y - bounds.minY) / -backY);
  return Math.max(0, roomMm);
}

function insideBounds(point: Vec2, bounds: JobBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}
