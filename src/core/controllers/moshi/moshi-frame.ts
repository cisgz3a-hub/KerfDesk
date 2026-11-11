// The footprint a Moshi Frame proves (ADR-705). MeerK40t documents no
// board-side frame command, so the Frame is a program of its own: laser-off
// moves around the job's bounds (moshi-programs.ts writeFrameProgram), at the
// profile's framing speed. Start compares the job's footprint with the last
// completed Frame's, so a moved or resized job needs a new Frame (PROJECT.md
// non-negotiable 21, ADR-565). A Moshi job is always absolute from the home
// corner, so the bounds alone are the footprint.

import { MOSHI_VECTOR_SPEED_MAX_MM_S } from './moshi-program';
import { writeFrameProgram } from './moshi-programs';
import type { MoshiBounds } from './moshi-units';

export type MoshiFootprint = MoshiBounds;

export function sameMoshiFootprint(a: MoshiFootprint | null, b: MoshiFootprint | null): boolean {
  if (a === null || b === null) return false;
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

/** The Frame program at the profile's framing feed (mm/min), within the
 *  vector speed byte. */
export function encodeMoshiFrameProgram(
  footprint: MoshiFootprint,
  framingFeedMmPerMin: number,
): Uint8Array {
  const speedMmS = Math.min(MOSHI_VECTOR_SPEED_MAX_MM_S, Math.max(1, framingFeedMmPerMin / 60));
  return writeFrameProgram(footprint, speedMmS);
}
