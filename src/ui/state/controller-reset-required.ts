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

import type { ControllerEvent } from '../../core/controllers/controller-event';
import type { LaserState } from './laser-store';

export const RESET_REQUIRED_MESSAGE =
  'The controller stopped on a critical event (hard or soft limit, E-stop or motor fault) and accepts only a soft reset. Press Reset (Ctrl-X), then Unlock or Home.';

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
