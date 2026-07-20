// FrameVerification — proof that a clean required Frame ran for the current
// compiled job (ADR-053 P2 / ADR-228).
//
// Recorded when a frame is dispatched, holding the bounds identity the Frame
// safety check proved plus the origin identity (WCO + active flag) at that
// moment. For laser work this is the complete emitted-motion envelope, including
// runways and scan offsets; CNC preserves its traced XY-bounds identity. Start
// compares it against the live values, so motion-envelope drift requires a new
// Frame even when the artwork's burn rectangle did not change.
//
// Invalidation is mostly structural — the recorded WCO / workOriginActive differ
// from the live ones after a disconnect, soft-reset, or origin move (the store
// also clears this explicitly at those sites for the no-position-feedback case),
// and the bounds signature differs after any relevant motion change. Lives in
// ui/state (not ui/laser) so the laser-store can own the field without a
// state -> laser dependency.

import type { WorkCoordinateOffset } from './origin-actions';

export type FrameVerification = {
  readonly boundsSignature: string;
  readonly wco: WorkCoordinateOffset | null;
  readonly workOriginActive: boolean;
};

export type FrameVerificationContext = {
  readonly boundsSignature: string;
  readonly wco: WorkCoordinateOffset | null;
  readonly workOriginActive: boolean;
};

export function isVerifiedFrameValid(
  recorded: FrameVerification | null,
  current: FrameVerificationContext,
): boolean {
  if (recorded === null) return false;
  return (
    recorded.boundsSignature === current.boundsSignature &&
    recorded.workOriginActive === current.workOriginActive &&
    wcoEquals(recorded.wco, current.wco)
  );
}

function wcoEquals(a: WorkCoordinateOffset | null, b: WorkCoordinateOffset | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
