// Tangential feed-matched entry runways for contour starts on the 4040-safe
// profile (ADR-239). ADR-234 gave scanline fill sweeps a bounded laser-off
// `G1 S0` entry at burn feed, but Line-mode contours and Follow Shape
// (offset) fill loops still opened with power on the first move out of the
// seek junction — the same start-from-low-speed mechanism behind the 4040
// uneven-lettering burn. The entry runs collinear with the contour's first
// burn edge so GRBL's junction planner carries the entry feed straight into
// the ink instead of stopping at the junction.
//
// ADR-239 Amendment 2 mirrors it at the other end for constant-power (M3)
// contours: the head leaves the last vertex along the last burn edge, laser
// off at burn feed, so it decelerates dark instead of stopping at full power
// on the ink. GRBL's laser_mode.md asks for both under M3 ("add lead-in and
// lead-out motions around the line you want to cut").

import {
  machineBoundsForDevice,
  resolveGrblDialect,
  type DeviceProfile,
  type GrblPowerMode,
} from '../devices';
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

/**
 * Exit-runway length (mm) for a contour group (ADR-239 Amendment 2): the
 * entry's length where the group burns with constant power (M3), else
 * undefined. Under dynamic power (M4) GRBL already lowers power as the head
 * decelerates, so an exit would only add motion. The layer's own power mode
 * wins over the dialect's default, as in emission (`vectorPowerWord`).
 */
export function contourExitRunwayMm(
  device: DeviceProfile,
  entryRunwayMm: number | undefined,
  kind: 'cut' | 'fill',
  layerPowerMode: GrblPowerMode | undefined,
): number | undefined {
  if (entryRunwayMm === undefined) return undefined;
  const dialect = resolveGrblDialect(device);
  const mode = layerPowerMode ?? (kind === 'fill' ? dialect.fillPowerMode : dialect.cutPowerMode);
  return mode === 'constant' ? entryRunwayMm : undefined;
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

/** True when the job omits every contour entry because the bed's position in
 * program coordinates is unknown (ADR-343). The G-code comment and Job Review
 * then say the entry was skipped, not effective (ADR-239 Amendment 1). */
export function contourEntriesSkipped(job: Pick<Job, 'contourEntryBounds'>): boolean {
  return job.contourEntryBounds === null;
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
  return tangentRunwayPoint(polyline, 0, 1, leadMm, bed);
}

/**
 * Where the laser-off exit ends for one contour (ADR-239 Amendment 2): the
 * last vertex carried on `leadMm` along the direction of the last
 * non-degenerate edge, bounded by the bed exactly as the entry is. Null in
 * the same cases, including an unknown bed envelope (ADR-343).
 */
export function contourExitPoint(
  polyline: ReadonlyArray<Vec2>,
  leadMm: number,
  bed?: ContourEntryBounds,
): Vec2 | null {
  return tangentRunwayPoint(polyline, polyline.length - 1, -1, leadMm, bed);
}

// The runway leaves `anchor` straight away from its nearest materially
// distinct neighbour (searched in `step` direction), so it is collinear with
// the burn edge that meets the anchor.
function tangentRunwayPoint(
  polyline: ReadonlyArray<Vec2>,
  anchorIndex: number,
  step: 1 | -1,
  leadMm: number,
  bed: ContourEntryBounds,
): Vec2 | null {
  const anchor = polyline[anchorIndex];
  if (anchor === undefined || leadMm <= 0 || bed === null) return null;
  for (let i = anchorIndex + step; i >= 0 && i < polyline.length; i += step) {
    const pt = polyline[i];
    if (pt === undefined) continue;
    const awayX = anchor.x - pt.x;
    const awayY = anchor.y - pt.y;
    const edgeMm = Math.hypot(awayX, awayY);
    if (edgeMm < MIN_TANGENT_EDGE_MM) continue;
    const unitX = awayX / edgeMm;
    const unitY = awayY / edgeMm;
    const boundedMm =
      bed === undefined ? leadMm : bedBoundedLeadMm(anchor, unitX, unitY, leadMm, bed);
    if (boundedMm < MIN_TANGENT_EDGE_MM) return null;
    return { x: anchor.x + unitX * boundedMm, y: anchor.y + unitY * boundedMm };
  }
  return null;
}

// Room from `from` along the unit runway direction before leaving the bed,
// capped at leadMm. A start (or end) already outside the bed yields 0 (no
// runway) and leaves the job to the existing out-of-bed preflight reporting.
function bedBoundedLeadMm(
  from: Vec2,
  dirX: number,
  dirY: number,
  leadMm: number,
  bed: JobBounds | BedSizeMm,
): number {
  const bounds = 'minX' in bed ? bed : { minX: 0, minY: 0, maxX: bed.widthMm, maxY: bed.heightMm };
  // The explicit envelope contract never invents travel for an outside start.
  // Legacy size-only input retains archived output, including its old clamp.
  if ('minX' in bed && !insideBounds(from, bounds)) return 0;
  let roomMm = leadMm;
  if (dirX > 0) roomMm = Math.min(roomMm, (bounds.maxX - from.x) / dirX);
  else if (dirX < 0) roomMm = Math.min(roomMm, (from.x - bounds.minX) / -dirX);
  if (dirY > 0) roomMm = Math.min(roomMm, (bounds.maxY - from.y) / dirY);
  else if (dirY < 0) roomMm = Math.min(roomMm, (from.y - bounds.minY) / -dirY);
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
