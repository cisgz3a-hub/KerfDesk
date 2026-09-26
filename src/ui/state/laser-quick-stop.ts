// laser-quick-stop — the stop of a controller that has no realtime reset
// (Marlin; controller audit MA-7 and CG-10). Wherever a GRBL-family controller
// gets its soft reset (Abort, ABORT MOTION, the stop after a stream error,
// Disconnect with a job running), such a controller gets the driver's
// quickstop lines (Marlin: M107, M410, M5 I), then M9 when air assist may be
// on, all as ordinary lines that owe acknowledgements. A driver without
// quickstop lines falls back to its beam-off stopLaserLines.
//
// Only M9 switches Marlin's air assist off (M7-M9.cpp L64-L75), so it follows
// the quickstop whenever KerfDesk switched air on or the job's program does.
// Without AIR_ASSIST it is an "Unknown command" that Marlin still answers.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M7-M9.cpp#L64-L75

import type { ControllerDriver } from '../../core/controllers';
import type { StreamerState } from '../../core/controllers/grbl';
import type { LaserState } from './laser-store';

const AIR_OFF_LINE = 'M9';
const AIR_ON_RE = /^\s*(?:N\d+\s*)?M0*[78](?![\d.])/i;

type QuickStopSource = Pick<LaserState, 'airAssistOn' | 'streamer'>;

/** True when the driver stops with its own quickstop lines. */
export function driverQuickStops(driver: ControllerDriver): boolean {
  return (driver.commands.quickStopLines?.length ?? 0) > 0;
}

/** The ordered, newline-terminated stop lines of a controller without a
 * realtime reset. */
export function noResetStopLines(
  driver: ControllerDriver,
  state: QuickStopSource,
): ReadonlyArray<string> {
  const lines = driver.commands.quickStopLines ?? driver.commands.stopLaserLines;
  return [...lines, ...airOffLines(driver, state, lines)].map((line) => `${line}\n`);
}

/** M9 after `stopLines` when air assist may be on and they do not already
 * switch it off. No trailing newline. */
export function airOffLines(
  driver: ControllerDriver,
  state: QuickStopSource,
  stopLines: ReadonlyArray<string> = driver.commands.stopLaserLines,
): ReadonlyArray<string> {
  if (stopLines.some(isAirOffLine)) return [];
  return state.airAssistOn || streamSwitchesAirOn(state.streamer) ? [AIR_OFF_LINE] : [];
}

export function isAirOffLine(line: string): boolean {
  return line.trim().toUpperCase() === AIR_OFF_LINE;
}

/** The job's program switches air assist on (M7 or M8) anywhere. */
function streamSwitchesAirOn(streamer: StreamerState | null): boolean {
  return streamer !== null && streamer.queued.some((line) => AIR_ON_RE.test(line));
}

/** Store patch after a quickstop: M410 halts the motors without slowing down,
 * so the steppers may have lost position (M108_M112_M410.cpp L46-L53). Homing
 * and position evidence are unverified, as after GRBL's reset. The G92 origin
 * record is kept: Marlin keeps its position_shift through M410. A jog or Frame
 * still owning motion is cancelled so none of its remaining lines follow. */
export function quickStopPatch(
  state: LaserState,
): Pick<LaserState, 'homingState' | 'homingProof' | 'trustedPositionEpoch' | 'motionOperation'> {
  const operation = state.motionOperation;
  return {
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    motionOperation:
      operation === null || operation.mpgInterruptionId !== undefined
        ? operation
        : { ...operation, cancelRequested: true },
  };
}
