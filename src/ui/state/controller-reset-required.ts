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
// A controller stopped before KerfDesk opened the port printed its message to
// nobody: a board that does not reset when the port opens (most 32-bit and
// ESP32 boards) keeps the lock, and a reload or reconnect misses it too. Three
// replies latch the same state without the message (UX audit U5-P2-1, ADR-393
// Amendment 1):
//   - error:79 to any line, which only grblHAL sends and only while a critical
//     event blocks it (Status_NotAllowedCriticalEvent). Stock GRBL stops at
//     error:38 and FluidNC skips from 70 to 80, so the stock driver a
//     banner-less grblHAL board connects on reads it the same way;
//   - an Alarm report whose `Pn:` holds E: grblHAL raises its critical E-stop
//     alarm whenever that input is on. Not on FluidNC: its E input raises a
//     critical Hard Stop only when it trips outside Alarm (Protocol.cpp
//     protocol_do_fault_pin), and the next rule catches that state;
//   - an Alarm report right after the controller acknowledged `$X`, with no
//     ALARM:N between them: FluidNC's Critical state (reported as Alarm). Every
//     other GRBL family unlock either leaves Alarm or answers an error.
// Not a status `Alarm:N` substate: grblHAL keeps the critical code there after
// the reset that cleared it, so it would offer Reset for ever.
// Stock GRBL in its critical loop answers nothing at all; the stopped-answering
// card's Reconnect sends the Ctrl-X that frees it (ADR-642).
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
import type { ControllerKind } from '../../core/devices';
import type { LaserSafetyNotice } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { AlarmRaisedRecord } from './position-kept-alarm';

/** The controller's alarm lock, as LaserState holds it. */
export type AlarmLockState = {
  // The last ALARM:N, until a report that is not Alarm or Sleep.
  readonly alarmCode: number | null;
  // What that ALARM:N line was raised under; Unlock reads it to decide whether
  // the position still stands (position-kept-alarm.ts). Optional so hand-built
  // test states stay valid; absent reads as none, which hides the position.
  readonly alarmRaised?: AlarmRaisedRecord | null;
  // The firmware printed "Reset to continue" after a critical event, or a
  // reply above showed one it printed before the connection: only a soft
  // reset is accepted until the reboot banner. 'homing-state': stock GRBL
  // stays in its homing state after refusing a `$HX`; the banner offers the
  // same reset and nothing is held (audit A-7).
  readonly resetRequired?: boolean | 'homing-state';
  // The controller acknowledged `$X`; the next status report says whether it
  // unlocked, as FluidNC's Critical state acknowledges it and stays in Alarm.
  readonly unlockAwaitsReport?: boolean;
};

export const RESET_REQUIRED_MESSAGE =
  'The controller stopped on a critical event (hard or soft limit, E-stop or motor fault) and accepts only a soft reset. Press Reset (Ctrl-X), then Unlock or Home.';

/** The card's words when no ALARM:N was seen: the lock predates the connection. */
const BEFORE_CONNECT_MESSAGE =
  'The controller was stopped by its E-stop or a limit switch before KerfDesk connected, and accepts only a reset. Release the E-stop or move the head off the switch, then press Reset (Ctrl-X). After the reset, Unlock or Home.';

export const HOMING_STATE_RESET_MESSAGE =
  'The controller reports Home with no homing cycle running. Stock GRBL refuses a single-axis Home such as $HX with error:3 when it was built without single-axis homing, and then stays in its homing state, running no motion, until a soft reset. Press Reset (Ctrl-X), then Unlock or Home.';

const AFTER_PHYSICAL_STEP =
  'Then press Reset (Ctrl-X): the controller accepts nothing else until it is reset. After the reset, Unlock or Home.';

const CRITICAL_EVENT_RE = /reset to continue/i;
// grblHAL's Status_NotAllowedCriticalEvent (see above).
const CRITICAL_EVENT_REFUSAL_CODE = 79;
const GRBL_FAMILY: ReadonlyArray<ControllerKind> = ['grbl-v1.1', 'grblhal', 'fluidnc'];

/** True for `[MSG:Reset to continue]` (GRBL, grblHAL) and
 *  `[MSG:ERR: Reset to continue]` (FluidNC). */
function isCriticalEventMessage(event: ControllerEvent): boolean {
  return event.kind === 'message' && CRITICAL_EVENT_RE.test(event.body);
}

type ResetLatchPatch = Partial<Pick<LaserState, 'resetRequired' | 'unlockAwaitsReport' | 'log'>>;

/** What a controller line proves about a critical event, as a store patch, or
 *  null when it changes nothing. A status report is read before it is applied. */
export function resetRequiredLinePatch(
  state: LaserState,
  event: ControllerEvent,
  driverKind: ControllerKind,
): ResetLatchPatch | null {
  if (event.kind === 'status') return statusResetRequiredPatch(state, event.report, driverKind);
  if (state.resetRequired === true) return null;
  if (isCriticalEventMessage(event)) return latchPatch(state, RESET_REQUIRED_MESSAGE);
  const refused =
    event.kind === 'error' &&
    event.code === CRITICAL_EVENT_REFUSAL_CODE &&
    GRBL_FAMILY.includes(driverKind);
  return refused
    ? latchPatch(
        state,
        `error:79 means a critical event is still active. ${BEFORE_CONNECT_MESSAGE}`,
      )
    : null;
}

// An E-stop input in Alarm, or an acknowledged `$X` that left Alarm in place.
function statusResetRequiredPatch(
  state: LaserState,
  report: Pick<StatusReport, 'state' | 'pins'>,
  driverKind: ControllerKind,
): ResetLatchPatch | null {
  const awaited = state.unlockAwaitsReport === true;
  const consumed = awaited ? { unlockAwaitsReport: false } : null;
  if (report.state !== 'Alarm' || state.resetRequired === true) return consumed;
  if (!GRBL_FAMILY.includes(driverKind)) return consumed;
  const evidence =
    report.pins?.estop === true && driverKind !== 'fluidnc'
      ? 'The controller reports its E-stop input on.'
      : awaited
        ? 'The controller acknowledged Unlock ($X) but still reports Alarm.'
        : null;
  return evidence === null ? consumed : latchPatch(state, `${evidence} ${BEFORE_CONNECT_MESSAGE}`);
}

function latchPatch(state: LaserState, logLine: string): ResetLatchPatch {
  return {
    resetRequired: true,
    unlockAwaitsReport: false,
    log: pushLog(state, `[lf2] ${logLine}`),
  };
}

/** The reboot banner is the soft reset the latch asked for. A refused `$X` or
 *  `$H` moved nothing, so its error:79 notice goes with the latch. */
export function resetBoundaryPatch(
  state: Pick<LaserState, 'safetyNotice'>,
): Partial<Pick<LaserState, 'resetRequired' | 'unlockAwaitsReport' | 'safetyNotice'>> {
  return {
    resetRequired: false,
    unlockAwaitsReport: false,
    ...(isRefusedCommandDuringCriticalEvent(state.safetyNotice) ? { safetyNotice: null } : {}),
  };
}

function isRefusedCommandDuringCriticalEvent(notice: LaserSafetyNotice | null): boolean {
  return (
    notice?.kind === 'controller-error' &&
    notice.code === CRITICAL_EVENT_REFUSAL_CODE &&
    notice.rejectedLine?.startsWith('$') === true
  );
}

/** Why an operator command cannot reach the controller until it is reset. */
export function resetRequiredBlockMessage(state: Pick<LaserState, 'resetRequired'>): string | null {
  return state.resetRequired === true ? RESET_REQUIRED_MESSAGE : null;
}

/** Why the Alarm banner offers Reset (Ctrl-X), or null when it does not. The
 *  alarm's own physical step comes first, since a reset with the E-stop still
 *  pressed only raises the alarm again (UX audit U5-P3-2). */
export function resetOfferMessage(
  resetRequired: LaserState['resetRequired'],
  alarm: { readonly code: number | null; readonly controllerKind: ControllerKind },
): string | null {
  if (resetRequired === 'homing-state') return HOMING_STATE_RESET_MESSAGE;
  if (resetRequired !== true) return null;
  if (alarm.code === null) return BEFORE_CONNECT_MESSAGE;
  const step = criticalAlarmStep(alarm.code, alarm.controllerKind);
  return step === null ? RESET_REQUIRED_MESSAGE : `${step} ${AFTER_PHYSICAL_STEP}`;
}

// Code 10 is critical only on grblHAL (E-stop); a latched 10 on the stock
// driver is a grblHAL board that sent no banner (alarm-codes.ts). FluidNC's 10
// is Spindle Control and 17 a G-code error, neither critical; its 13, Hard
// Stop, is what its E-stop and fault inputs raise (protocol_do_fault_pin).
function criticalAlarmStep(code: number, controllerKind: ControllerKind): string | null {
  if (code === 1) return 'Clear whatever the head ran into, and move it off the limit switch.';
  if (controllerKind === 'fluidnc') {
    return code === 13 ? 'Release the E-stop, or clear the fault the controller reports.' : null;
  }
  if (code === 10) return 'Release the E-stop (twist or pull the button out).';
  if (code === 17) return 'Check the motor drivers and their wiring.';
  return null;
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
