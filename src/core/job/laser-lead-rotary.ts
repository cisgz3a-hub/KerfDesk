// Laser leads on an active rotary (ADR-626). The rotary rebases Y, so a lead
// keeps only the bed's X limits. The job wraps round the object, so surface Y
// and Y plus one circumference are the same place. Leads measure clearance in
// the plane, so every cut line within a lead's reach of either end of the job
// is also indexed one circumference up or down. A lead near one end then keeps
// clear of a cut near the other, as it does of its neighbours.

import { rotaryCircumferenceMm, type DeviceProfile } from '../devices';
import type { MachineConfig, Vec2 } from '../scene';
import type { Job } from './job';
import type { JobBounds } from './job-bounds';
import { MAX_LEAD_CLEARANCE_MM, MAX_LEAD_LENGTH_MM } from './laser-lead-settings';
import { rotaryAppliesTo } from './rotary-job';
import { jobYRange } from './rotary-transform';
import { polylineBounds } from './segment-bounds';

// The farthest a lead or its clearance can reach from the cut it joins, with
// room to spare.
const WRAP_REACH_MM = MAX_LEAD_LENGTH_MM + MAX_LEAD_CLEARANCE_MM + 1;

/** Where leads must stay and how the job wraps, for the project's machine. */
export function laserLeadOptions(
  device: DeviceProfile,
  machine: MachineConfig | undefined,
  bed: JobBounds | null,
): {
  readonly bed: JobBounds | null;
  readonly wrapMm: number | null;
  readonly device: DeviceProfile;
} {
  const rotary = rotaryAppliesTo(device, machine) ? device.rotary : undefined;
  return {
    bed: laserLeadBed(bed, rotary !== undefined),
    wrapMm: rotary === undefined ? null : rotaryCircumferenceMm(rotary),
    device,
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

// Kept clear of one full turn, so rounding in the output cannot tip a job that
// fits exactly over the wrap limit.
const TURN_MARGIN_MM = 0.01;

/** The Y the job spans as the rotary rebases it, widened as leads are placed. */
export type LeadSpan = { min: number; max: number };

export function leadSpan(job: Job, wrap: LeadWrap | null): LeadSpan | null {
  const range = wrap === null ? null : jobYRange(job);
  return range === null ? null : { min: range.min, max: range.max };
}

/** Where a lead may go on an active rotary: within the bed's X limits, and
 * near enough the job's ends that the job, its leads so far included, still
 * spans no more than one turn, the wrap limit the output is checked against.
 * Measured from the job itself, not from where it sits on the flat bed. */
export function rotaryLeadBed(
  bed: JobBounds | null,
  wrap: LeadWrap | null,
  span: LeadSpan | null,
): JobBounds | null {
  if (wrap === null || span === null) return bed;
  const turn = wrap.circumferenceMm - TURN_MARGIN_MM;
  return {
    minX: bed?.minX ?? Number.NEGATIVE_INFINITY,
    maxX: bed?.maxX ?? Number.POSITIVE_INFINITY,
    minY: span.max - turn,
    maxY: span.min + turn,
  };
}

/** Widens the span by placed leads, as they will burn. */
export function widenLeadSpan(
  span: LeadSpan | null,
  lines: ReadonlyArray<ReadonlyArray<Vec2>>,
): void {
  if (span === null) return;
  for (const line of lines) {
    for (const point of line) {
      span.min = Math.min(span.min, point.y);
      span.max = Math.max(span.max, point.y);
    }
  }
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
