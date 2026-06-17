// frameBoundsSignature — identity of the rectangle a Verified Frame traces.
//
// The Verified Frame jogs the placed job's bounding box (laser off) so the
// operator confirms it fits the travel from a hand-set origin (ADR-053 P2).
// Start re-derives this signature from the same placed bounds; a mismatch means
// the job moved or resized since the frame, so the frame's "it fits" guarantee
// no longer holds and a fresh frame is required. Interior toolpath changes that
// stay within the same rectangle keep the guarantee, so the signature is the
// bounds alone — exactly what the frame physically verified.
//
// Rounded to emit precision (3 dp) so float noise never forces a needless
// re-frame. Pure: no clock, no random, no I/O.

import type { JobBounds } from './job-bounds';

const SIGNATURE_PLACES = 3;

function roundToSignaturePlaces(value: number): number {
  const factor = 10 ** SIGNATURE_PLACES;
  return Math.round(value * factor) / factor;
}

export function frameBoundsSignature(bounds: JobBounds): string {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map(roundToSignaturePlaces).join(',');
}
