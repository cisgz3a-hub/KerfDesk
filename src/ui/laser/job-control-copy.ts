import type { MachineKind } from '../../core/scene';
import { cncPauseMessage } from '../state/cnc-pause-resume-policy';

const PAUSE_HOLD_SAFETY_MESSAGE =
  'Pause is feed hold only. Use ABORT JOB or the physical E-stop if unsafe.';
const PAUSE_STREAM_SIDE_MESSAGE =
  'Pause stops sending; buffered firmware motion may finish. Use ABORT JOB or the physical E-stop if unsafe.';

export function pauseControlMessage(
  machineKind: MachineKind | null,
  hasRealtimePause: boolean,
): string {
  return (
    cncPauseMessage(machineKind) ??
    (hasRealtimePause ? PAUSE_HOLD_SAFETY_MESSAGE : PAUSE_STREAM_SIDE_MESSAGE)
  );
}

export function resumeControlTitle(blockMessage: string | null, hasRealtimePause: boolean): string {
  if (blockMessage !== null) return blockMessage;
  return hasRealtimePause
    ? 'Release the feed hold and continue the job'
    : 'Continue sending the remaining job lines';
}
