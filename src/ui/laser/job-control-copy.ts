import type { ControllerKind } from '../../core/devices';
import type { MachineKind } from '../../core/scene';
import { cncPauseMessage } from '../state/cnc-pause-resume-policy';

// GRBL-family Pause sends the safety-door byte so the beam goes dark (ADR-212);
// "feed hold only" named the wrong mechanism (UX audit U4-P3-1).
const PAUSE_HOLD_SAFETY_MESSAGE =
  'Pause stops the head and switches the laser off. Use ABORT JOB or the physical E-stop if anything is unsafe.';
const PAUSE_STREAM_SIDE_MESSAGE =
  'Pause stops sending; buffered firmware motion may finish. Use ABORT JOB or the physical E-stop if unsafe.';
// Marlin (controller audit MA-1): the moves it already accepted still run,
// then the queued beam-off switches the laser off.
const PAUSE_STREAM_SIDE_BEAM_OFF_MESSAGE =
  'Pause stops sending. The controller finishes the moves it has already accepted, then the ' +
  'beam-off KerfDesk queues behind them switches the laser off. Use ABORT JOB or the physical ' +
  'E-stop if unsafe.';

export function pauseControlMessage(
  machineKind: MachineKind | null,
  hasRealtimePause: boolean,
  streamPauseBeamOff = false,
  controllerKind: ControllerKind | null = null,
): string {
  return (
    cncPauseMessage(machineKind, controllerKind) ??
    streamPauseMessage(hasRealtimePause, streamPauseBeamOff)
  );
}

// A GRBL-family reset raises ALARM:3 and may lose steps only while the machine
// moves; after a hold that has finished it raises no alarm and keeps position
// (ADR-215 Amendment 1, GRBL `mc_reset`). The reset still clears a Set origin
// here origin on stock GRBL and FluidNC, so this names position only.
export const PAUSE_THEN_ABORT_NOTE =
  'For a stop that is not urgent, Pause first, wait for the head to stop, then ABORT JOB: ' +
  'the controller then keeps its position.';

/** The Pause button's tooltip: the notice, and for a laser job on a controller
 *  with a realtime hold, how to stop without the controller losing position
 *  (user annoyance audit A3-D-1, ADR-341 Amendment 14). */
export function pauseControlTitle(
  machineKind: MachineKind | null,
  hasRealtimePause: boolean,
  streamPauseBeamOff = false,
  controllerKind: ControllerKind | null = null,
): string {
  const message = pauseControlMessage(
    machineKind,
    hasRealtimePause,
    streamPauseBeamOff,
    controllerKind,
  );
  return message === PAUSE_HOLD_SAFETY_MESSAGE ? `${message} ${PAUSE_THEN_ABORT_NOTE}` : message;
}

function streamPauseMessage(hasRealtimePause: boolean, streamPauseBeamOff: boolean): string {
  if (hasRealtimePause) return PAUSE_HOLD_SAFETY_MESSAGE;
  return streamPauseBeamOff ? PAUSE_STREAM_SIDE_BEAM_OFF_MESSAGE : PAUSE_STREAM_SIDE_MESSAGE;
}

export function resumeControlTitle(
  advisory: string | null,
  hasRealtimePause: boolean,
  streamPauseBeamOff = false,
): string {
  if (advisory !== null) return advisory;
  if (hasRealtimePause) return 'Release the hold and continue the job';
  return streamPauseBeamOff
    ? "Switch the laser back on in the job's own commands, then continue sending the remaining job lines"
    : 'Continue sending the remaining job lines';
}
