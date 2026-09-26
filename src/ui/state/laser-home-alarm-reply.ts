// laser-home-alarm-reply — keeps a stale Alarm status reply from aborting a
// Home that was written to a controller in Alarm (audit status-2).
//
// GRBL and grblHAL service pending realtime requests, including a '?' status
// query, at the end-of-line checkpoint before they execute the line: gnea/grbl
// protocol_main_loop calls protocol_execute_realtime() on the newline and only
// then system_execute_line() (https://github.com/gnea/grbl/blob/master/grbl/protocol.c),
// and grblHAL does the same (https://github.com/grblHAL/core/blob/master/protocol.c).
// $H enters the homing state only inside system_execute_line. So a '?' written
// before the operator clicked Home can be answered '<Alarm|...>' after KerfDesk
// wrote $H, and the host cannot tell that reply from a new Alarm. Treating it
// as one cancelled the Home while the machine went on to home: the failure was
// silent, homingState stayed unknown, and a startup ALARM:11 stayed latched so
// Start and Fire were refused on an Idle, homed machine.
//
// A genuine failure is still seen: a failed homing cycle emits ALARM:N (GRBL
// alarms 6-9) and a refused $H answers error:N, and both reject the owned Home
// command directly. The Home command timeout is not refreshed by Alarm
// reports, so a controller that stays in Alarm without either still times out.

import type { StatusReport } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { statusPositionPatch } from './laser-status-position';

/** An Alarm report that may predate the Home line KerfDesk just wrote. */
export function isStaleHomeAlarmReply(state: LaserState, report: StatusReport): boolean {
  const operation = state.controllerOperation;
  return (
    report.state === 'Alarm' &&
    // A pendant takeover is new evidence whatever the report's age.
    report.mpgActive !== true &&
    operation?.kind === 'home' &&
    operation.phase === 'command' &&
    operation.awaitingFirstNonAlarmReport === true
  );
}

/** Shows the stale reply without invalidating the Home it may predate. */
export function staleHomeAlarmReplyPatch(
  state: LaserState,
  report: StatusReport,
): Partial<LaserState> {
  return {
    ...statusPositionPatch(state, report),
    log: pushLog(
      state,
      '[lf2] Alarm status received right after Home was sent; waiting for the controller to start homing.',
    ),
  };
}

/** Opens the stale-reply window again before a further line of a per-axis Home
 * sequence (the Falcon's `$HX` then `$HY`). grblHAL with its homing lock goes
 * back into Alarm when `$HX` finishes while Y is still unhomed, and prints no
 * ALARM line for it (grblHAL core system.c:494-505, go_home), so a `?` served
 * before `$HY` starts reads Alarm although the Home goes on (controller audit
 * 2026-09-25 HF-1). A failed cycle still ends the Home through its ALARM:N or
 * error:N reply. */
export function reopenHomeAlarmReplyWindow(
  state: LaserState,
): Partial<Pick<LaserState, 'controllerOperation'>> {
  const operation = state.controllerOperation;
  if (operation?.kind !== 'home' || operation.phase !== 'command') return {};
  return { controllerOperation: { ...operation, awaitingFirstNonAlarmReport: true } };
}

/** The first non-Alarm report after the Home line closes the stale-reply window:
 * from then on an Alarm report is a new Alarm. */
export function homeAlarmReplyWindowPatch(
  state: LaserState,
  report: StatusReport,
): Partial<Pick<LaserState, 'controllerOperation'>> {
  const operation = state.controllerOperation;
  if (
    operation?.kind !== 'home' ||
    operation.awaitingFirstNonAlarmReport !== true ||
    report.state === 'Alarm'
  ) {
    return {};
  }
  const { awaitingFirstNonAlarmReport: closedWindow, ...rest } = operation;
  void closedWindow;
  return { controllerOperation: rest };
}
