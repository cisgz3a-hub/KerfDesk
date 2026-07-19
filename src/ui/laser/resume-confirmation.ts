import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl/resume-program';
import type { MachineKind } from '../../core/scene';

export function resumeConfirmation(
  machineKind: MachineKind,
  requestedLine: number,
  recoveryLine: number,
): string {
  if (machineKind === 'cnc') {
    return `CNC recovery is disabled:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`;
  }
  const details = `The machine will move to the recorded position with the beam off, then replay from line ${recoveryLine}.`;
  const archiveWarning =
    'MANUAL LIMITATION: this start is not sealed against the original prepared job and will not create an execution-archive or recovery record.';
  return `Review resume from requested line ${requestedLine}:\n\n${details}\n\n${archiveWarning}\n\nThe work zero must be UNCHANGED since the original run. Continue?`;
}
