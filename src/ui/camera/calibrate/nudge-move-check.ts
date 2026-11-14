// What Fix a small offset may claim (ADR-663 Amendment 7, camera audit v2
// K1-P1-2). The fix moves the whole picture by the one offset its ring shows
// at the middle of the bed. A camera that tipped 1° read 8.7 mm there, under
// the 10 mm limit, so Fix was offered; afterwards the bed was still up to
// 6.8 mm off, and the Fix renewed the camera-moved reference and marked the
// camera steady, clearing the warning that had seen the turn. A 0.5-1° roll
// moved the middle ring by 0.05 mm, so the screen said "Nothing to fix" while
// the bed was 3.9-5.7 mm off.
//
// The camera-moved check (ADR-663 Amendment 5) measures how far the bed's
// middle and its four corners moved. The corners' disagreement with the
// middle is what one offset leaves behind, so a measured turn refuses the
// fix; a view that no longer matches keeps its warning through a fix.

import type { CameraMovedState } from '../helpers/camera-moved-store';
import { MOVED_MM } from '../../../core/camera/model/view-shift';

export type NudgeMoveCheck =
  /** The bed's corners moved this much more than its middle: one offset cannot fix that. */
  | { readonly kind: 'turned'; readonly cornersMm: number }
  /** The view around the bed no longer matches: a fix must not clear that warning. */
  | { readonly kind: 'changed' }
  /** A slide, or nothing measured: the fix lines up the middle, and says so. */
  | { readonly kind: 'open' };

/** What the moved check knows about the calibration saved at `calibratedAt`. */
export function nudgeMoveCheck(
  state: CameraMovedState,
  calibratedAt: string | undefined,
): NudgeMoveCheck {
  if (calibratedAt === undefined) return { kind: 'open' };
  if (state.kind === 'changed' && state.calibratedAt === calibratedAt) return { kind: 'changed' };
  if (state.kind !== 'moved' || state.calibratedAt !== calibratedAt) return { kind: 'open' };
  const [middle, ...corners] = state.displacementsMm;
  if (middle === undefined) return { kind: 'open' };
  const cornersMm = corners.reduce(
    (most, corner) => Math.max(most, Math.hypot(corner.x - middle.x, corner.y - middle.y)),
    0,
  );
  return cornersMm >= MOVED_MM ? { kind: 'turned', cornersMm } : { kind: 'open' };
}

/** Why a turned camera is not fixed with one offset. */
export function turnedCameraNote(check: Extract<NudgeMoveCheck, { kind: 'turned' }>): string {
  return `The camera turned or tipped: the camera-moved check measured the bed's corners up to about ${check.cornersMm.toFixed(1)} mm from where the middle puts them. Fix a small offset moves the whole picture by one offset, so it would line up the middle of the bed only. Calibrate again so the whole picture lines up.`;
}

/** What the fix does, and what it cannot see. */
export const MIDDLE_ONLY_NOTE =
  'It lines up the middle of the bed only. One ring cannot show a camera that tipped or turned: if the picture is off towards the edges, use Check camera or calibrate again.';
