// Home moves the laser's height on machines whose firmware re-references Z
// while it homes X and Y (ADR-322 Amendment 5). The maintainer's Falcon A1 Pro
// moved Z on a typed `$HX` then `$HY`, the exact Home KerfDesk sends for it,
// so any focus set before that Home is gone. KerfDesk cannot put the height
// back on its own: after Home the head sits at the front-left corner, which
// may not be over the material, so an automatic Auto-focus could measure the
// wrong surface. It says so instead, once after Home and in Job Review.
//
// A successful Auto-focus, or a Z jog (how a height is set by hand), clears
// the reminder. It is session-scoped through the controller session epoch, so
// a reconnect starts clean. It is a warning only and never gates Start
// (ADR-228, ADR-565).

import type { ControllerDriver } from '../../core/controllers';
import type { LaserState } from './laser-store';

/** Command sets whose Home is known to move Z. Add one only with evidence. */
const HOME_MOVES_FOCUS: ReadonlySet<NonNullable<ControllerDriver['commandSet']>> = new Set([
  'creality-falcon-a1-pro',
]);

export const HOME_MOVED_FOCUS_TOAST_KEY = 'home-moved-focus';

export const HOME_MOVED_FOCUS_REMINDER =
  "Home moved the laser's height: this machine's homing also moves Z. Move the head over your material and run Auto-focus again before you burn.";

export const HOME_MOVED_FOCUS_JOB_WARNING =
  "The laser's height has not been set since the last Home, and this machine's homing moves Z. Move the head over your material and run Auto-focus, or set the height by hand, before starting.";

type FocusState = Pick<
  LaserState,
  'activeControllerCommandSet' | 'controllerSessionEpoch' | 'focusMovedByHomeEpoch'
>;

/** True when the connected command set's Home is known to move Z. */
export function homeMovesFocus(commandSet: LaserState['activeControllerCommandSet']): boolean {
  return commandSet !== null && commandSet !== undefined && HOME_MOVES_FOCUS.has(commandSet);
}

/** The patch a Home applies as it starts: Z may move from the first homing
 * line, so a Home that later fails has still moved the height. */
export function homeMovedFocusPatch(
  state: FocusState,
): Partial<Pick<LaserState, 'focusMovedByHomeEpoch'>> {
  return homeMovesFocus(state.activeControllerCommandSet)
    ? { focusMovedByHomeEpoch: state.controllerSessionEpoch }
    : {};
}

/** The patch for a fresh height: a successful Auto-focus or a Z jog. */
export const FOCUS_SET_PATCH: Pick<LaserState, 'focusMovedByHomeEpoch'> = {
  focusMovedByHomeEpoch: null,
};

/** True while a Home in this controller session has moved Z since the height was last set. */
export function focusMovedByHome(state: FocusState): boolean {
  const epoch = state.focusMovedByHomeEpoch ?? null;
  return epoch !== null && epoch === state.controllerSessionEpoch;
}
