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
// also clears this explicitly at those sites, since an offset not reported yet
// compares as the zero it assumes, and for the no-position-feedback case),
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
    wcoEquals(
      effectiveWorkOffset(recorded.wco, recorded.workOriginActive),
      effectiveWorkOffset(current.wco, current.workOriginActive),
    )
  );
}

const ZERO_WORK_OFFSET: WorkCoordinateOffset = { x: 0, y: 0, z: 0 };

/** The offset a job was placed with: the reported WCO or, before the first
 * report, the zero KerfDesk assumes when no custom origin is known. GRBL puts
 * WCO in the very next report after any offset change, so a first report equal
 * to that zero confirms the assumption; it does not move the origin (ADR-375).
 * https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L280-L286 */
export function effectiveWorkOffset(
  wco: WorkCoordinateOffset | null,
  workOriginActive: boolean,
): WorkCoordinateOffset | null {
  return wco ?? (workOriginActive ? null : ZERO_WORK_OFFSET);
}

function wcoEquals(a: WorkCoordinateOffset | null, b: WorkCoordinateOffset | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
