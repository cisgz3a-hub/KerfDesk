// The descent into a CNC pass's first point (ADR-489), shared by the contour,
// path3d and arc passes of cnc-grbl-strategy.ts.
//
// From safe Z the cutter used to feed all the way down at the plunge rate,
// through air the job's earlier passes had already cleared. A pass that
// carries an air floor is rapided down to the floor plus
// CNC_AIR_RAPID_CLEARANCE_MM first, and only the rest is a G1 plunge. The
// rapid is Z-only, starts at safe Z (never from inside a cut) and stops above
// the pass's own start, so the plunge feed still meets any stock there.

import { CNC_AIR_RAPID_CLEARANCE_MM } from '../cnc/cnc-air-floor';
import { formatGcodeFeedMmPerMin } from '../gcode/feed-word';
import { fmt, type Head } from './cnc-grbl-emit-head';

export type EntryDescent = {
  /** The pass's first Z, formatted. */
  readonly startZ: string;
  readonly safeZMm: number;
  readonly airFloorZMm: number | undefined;
  readonly plunge: number;
};

/** Take the head from where it is straight down to the pass's first Z. */
export function appendEntryDescent(lines: string[], head: Head, descent: EntryDescent): void {
  if (head.z === descent.startZ) return;
  const rapidZ = airRapidTarget(head, descent);
  if (rapidZ !== null) {
    lines.push(`G0 Z${rapidZ}`);
    head.z = rapidZ;
  }
  lines.push(`G1 Z${descent.startZ} F${formatGcodeFeedMmPerMin(descent.plunge)}`);
  head.z = descent.startZ;
}

function airRapidTarget(head: Head, descent: EntryDescent): string | null {
  const floor = descent.airFloorZMm;
  if (floor === undefined || !Number.isFinite(floor)) return null;
  if (head.z !== fmt(Math.max(0, descent.safeZMm))) return null;
  const target = fmt(floor + CNC_AIR_RAPID_CLEARANCE_MM);
  const targetMm = Number(target);
  return targetMm < Number(head.z) && targetMm > Number(descent.startZ) ? target : null;
}
