// A critical controller event — hard limit, soft limit, E-stop, motor fault —
// leaves GRBL-family firmware accepting only a soft reset. Each firmware prints
// "Reset to continue" and then behaves differently:
//   - gnea/grbl 1.1h spins in a loop that answers nothing, not even `?`, until
//     Ctrl-X (protocol.c:224-236), so a `$X` or `$H` is never answered and its
//     owed acknowledgement wedges every later command;
//   - grblHAL answers `$X`, `$H` and `$SLP` with error:79 (system.c:1179-1181);
//   - FluidNC answers `$X` with `ok` but stays locked (ProcessSettings.cpp
//     disable_alarm_lock unlocks only State::Alarm, not State::Critical).
// The latch below records that state from the firmware's own message, holds
// Unlock, Home and the Console, and makes the Alarm banner offer Reset
// (Ctrl-X). A reboot banner ends it (controller audit 2026-09-25 GP-2, HF-2,
// HF-3; ADR-393).
//
// Stock GRBL also needs a reset after refusing a single-axis Home: it enters
// its homing state before it checks a `$H` suffix and, built without
// HOMING_SINGLE_AXIS_COMMANDS (the default), answers `$HX` with error:3 and
// never leaves that state. It reports Home and runs no motion until a reset
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L179-L194).
// A real cycle answers no status query until it ends, and then once, just
// before the `$H` ok (motion_control.c:239), so a Home report that no line
// still owed a reply accounts for is that state. The latch's 'homing-state'
// value makes the banner offer the same Reset and holds nothing: the
// controller still answers the Console, and Home, jog, Frame and Start
// already wait for Idle. The reboot banner after the reset ends it, and so
// does a report of any state but Home, Alarm or Sleep (controller audit A-7,
// ADR-375).

import type { ControllerEvent } from '../../core/controllers/controller-event';
import type { StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

export const RESET_REQUIRED_MESSAGE =
  'The controller stopped on a critical event (hard or soft limit, E-stop or motor fault) and accepts only a soft reset. Press Reset (Ctrl-X), then Unlock or Home.';

export const HOMING_STATE_RESET_MESSAGE =
  'The controller reports Home with no homing cycle running. Stock GRBL refuses a single-axis Home such as $HX with error:3 when it was built without single-axis homing, and then stays in its homing state, running no motion, until a soft reset. Press Reset (Ctrl-X), then Unlock or Home.';

const CRITICAL_EVENT_RE = /reset to continue/i;

/** True for `[MSG:Reset to continue]` (GRBL, grblHAL) and
 *  `[MSG:ERR: Reset to continue]` (FluidNC). */
export function isCriticalEventMessage(event: ControllerEvent): boolean {
  return event.kind === 'message' && CRITICAL_EVENT_RE.test(event.body);
}

/** Why an operator command cannot reach the controller until it is reset. */
export function resetRequiredBlockMessage(state: Pick<LaserState, 'resetRequired'>): string | null {
  return state.resetRequired === true ? RESET_REQUIRED_MESSAGE : null;
}

/** Why the Alarm banner offers Reset (Ctrl-X), or null when it does not. */
export function resetOfferMessage(resetRequired: LaserState['resetRequired']): string | null {
  if (resetRequired === true) return RESET_REQUIRED_MESSAGE;
  return resetRequired === 'homing-state' ? HOMING_STATE_RESET_MESSAGE : null;
}

/** A Home report from the stock GRBL driver that no Home line still owed a
 *  reply accounts for: the homing state a refused `$HX` left (see above). */
export function reportsStuckHomingState(
  state: Pick<LaserState, 'activeControllerKind' | 'controllerOperation' | 'pendingUntrackedAcks'>,
  report: Pick<StatusReport, 'state'>,
  streamAwaitsReply: boolean,
): boolean {
  return (
    report.state === 'Home' &&
    state.activeControllerKind === 'grbl-v1.1' &&
    state.controllerOperation?.kind !== 'home' &&
    state.pendingUntrackedAcks === 0 &&
    !streamAwaitsReply
  );
}
