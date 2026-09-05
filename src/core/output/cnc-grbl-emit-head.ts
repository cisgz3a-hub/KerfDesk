// Tracked emit-head primitives shared by the CNC GRBL emitter modules
// (cnc-grbl-strategy.ts and cnc-grbl-transitions.ts). The Head mirrors the
// last COMMANDED position at emit precision so the emitters can skip
// zero-length moves and redundant retracts by construction.

import { formatCncCoordinateMm } from '../cnc/coordinate-representation';
import { effectiveGcodeFeedMmPerMin } from '../gcode/feed-word';

/** Last commanded position, formatted — compared at emit precision. */
export type Head = {
  x: string | null;
  y: string | null;
  z: string | null;
};

/** Format a coordinate at the emitter's fixed decimal precision. */
export function fmt(n: number): string {
  return formatCncCoordinateMm(n);
}

/** Apply the portable emitted-feed contract. */
export function fmtFeed(feedMmPerMin: number): number {
  return effectiveGcodeFeedMmPerMin(feedMmPerMin);
}

/** Retract to the safe height unless the head is already there. */
export function appendRetract(lines: string[], head: Head, safeZMm: number): void {
  const safeZ = fmt(Math.max(0, safeZMm));
  if (head.z === safeZ) return;
  lines.push(`G0 Z${safeZ}`);
  head.z = safeZ;
}
