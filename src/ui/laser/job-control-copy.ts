import type { MachineKind } from '../../core/scene';
import { cncPauseMessage } from '../state/cnc-pause-resume-policy';

const PAUSE_HOLD_SAFETY_MESSAGE =
  'Pause is feed hold only. Use ABORT JOB or the physical E-stop if unsafe.';
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
): string {
  return cncPauseMessage(machineKind) ?? streamPauseMessage(hasRealtimePause, streamPauseBeamOff);
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
  if (hasRealtimePause) return 'Release the feed hold and continue the job';
  return streamPauseBeamOff
    ? "Switch the laser back on in the job's own commands, then continue sending the remaining job lines"
    : 'Continue sending the remaining job lines';
}
