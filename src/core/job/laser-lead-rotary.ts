// Laser leads on an active rotary (ADR-626). The rotary rebases Y, so a lead
// keeps only the bed's X limits. The job wraps round the object, so surface Y
// and Y plus one circumference are the same place. Leads measure clearance in
// the plane, so every cut line within a lead's reach of either end of the job
// is also indexed one circumference up or down. A lead near one end then keeps
// clear of a cut near the other, as it does of its neighbours.

import { rotaryCircumferenceMm, type DeviceProfile } from '../devices';
import type { MachineConfig, Vec2 } from '../scene';
import type { JobBounds } from './job-bounds';
import { MAX_LEAD_CLEARANCE_MM, MAX_LEAD_LENGTH_MM } from './laser-lead-settings';
import { rotaryAppliesTo } from './rotary-job';
import { polylineBounds } from './segment-bounds';

// The farthest a lead or its clearance can reach from the cut it joins, with
// room to spare.
const WRAP_REACH_MM = MAX_LEAD_LENGTH_MM + MAX_LEAD_CLEARANCE_MM + 1;

/** Where leads must stay and how the job wraps, for the project's machine. */
export function laserLeadOptions(
  device: DeviceProfile,
  machine: MachineConfig | undefined,
  bed: JobBounds | null,
): { readonly bed: JobBounds | null; readonly wrapMm: number | null } {
  const rotary = rotaryAppliesTo(device, machine) ? device.rotary : undefined;
  return {
    bed: laserLeadBed(bed, rotary !== undefined),
    wrapMm: rotary === undefined ? null : rotaryCircumferenceMm(rotary),
  };
}

/** The bed a lead must stay on: the program's bed, but on an active rotary
 * only its X limits. The rotary rebases Y and flat-bed Y placement means
 * nothing there, so the same artwork gets the same leads wherever it sits. */
export function laserLeadBed(bed: JobBounds | null, rotary: boolean): JobBounds | null {
  if (bed === null || !rotary) return bed;
  return {
    minX: bed.minX,
    maxX: bed.maxX,
    minY: Number.NEGATIVE_INFINITY,
    maxY: Number.POSITIVE_INFINITY,
  };
}

export type LeadWrap = {
  /** One turn of the object's surface, in job Y. */
  readonly circumferenceMm: number;
  readonly minY: number;
  readonly maxY: number;
};

/** The wrap of a job whose lines span `lines`; null when there is no rotary. */
export function leadWrap(
  circumferenceMm: number | null | undefined,
  lines: ReadonlyArray<ReadonlyArray<Vec2>>,
): LeadWrap | null {
  if (circumferenceMm === null || circumferenceMm === undefined) return null;
  if (!(circumferenceMm > 0) || !Number.isFinite(circumferenceMm)) return null;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const line of lines) {
    const box = polylineBounds(line);
    if (box === null) continue;
    minY = Math.min(minY, box.minY);
    maxY = Math.max(maxY, box.maxY);
  }
  return minY <= maxY ? { circumferenceMm, minY, maxY } : null;
}

/** The line one turn up and one turn down, where either comes within a lead's
 * reach of the job. */
export function wrappedCopies(
  points: ReadonlyArray<Vec2>,
  wrap: LeadWrap | null,
): ReadonlyArray<ReadonlyArray<Vec2>> {
  const box = wrap === null ? null : polylineBounds(points);
  if (wrap === null || box === null) return [];
  const turn = wrap.circumferenceMm;
  const copies: Vec2[][] = [];
  if (box.minY + turn <= wrap.maxY + WRAP_REACH_MM) copies.push(shifted(points, turn));
  if (box.maxY - turn >= wrap.minY - WRAP_REACH_MM) copies.push(shifted(points, -turn));
  return copies;
}

function shifted(points: ReadonlyArray<Vec2>, dy: number): Vec2[] {
  return points.map((point) => ({ x: point.x, y: point.y + dy }));
}
