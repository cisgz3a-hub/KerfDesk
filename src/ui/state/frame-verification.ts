// FrameVerification — proof that a clean Verified Frame ran for the current job
// at the current origin (ADR-053 P2).
//
// Recorded when a frame is dispatched in 'verified-origin' mode, holding the
// framed rectangle's signature plus the origin identity (WCO + active flag) at
// that moment. Start compares it against the live values; any drift means the
// frame no longer proves the job fits, so Start is blocked until a fresh frame.
//
// Invalidation is mostly structural — the recorded WCO / workOriginActive differ
// from the live ones after a disconnect, soft-reset, or origin move (the store
// also clears this explicitly at those sites for the no-position-feedback case),
// and the bounds signature differs after any resize/reposition. Lives in
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
