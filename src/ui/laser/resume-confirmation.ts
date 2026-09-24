import { CNC_AUTOMATIC_RECOVERY_DISABLED_REASON } from '../../core/controllers/grbl/resume-program';
import type { MachineKind } from '../../core/scene';

export function resumeConfirmation(
  machineKind: MachineKind,
  requestedLine: number,
  recoveryLine: number,
  tracking: 'manual' | 'saved-recovery' = 'manual',
  placementNote?: string,
): string {
  if (machineKind === 'cnc') {
    return `CNC recovery is disabled:\n\n${CNC_AUTOMATIC_RECOVERY_DISABLED_REASON}`;
  }
  const moves = `The machine will move to the recorded position with the beam off, then replay from line ${recoveryLine}.`;
  const details = placementNote === undefined ? moves : `${moves}\n\n${placementNote}`;
  const archiveWarning =
    tracking === 'saved-recovery'
      ? 'This recovery is saved as a new run so another interruption can be reviewed again.'
      : 'MANUAL LIMITATION: this start is not sealed against the original prepared job and will not create an execution-archive or recovery record.';
  const progressWarning =
    'Acknowledged commands may still have been buffered when the job stopped. Check the material and choose an earlier movement if needed; overlap may darken that area.';
  return `Review resume from requested line ${requestedLine}:\n\n${details}\n\n${progressWarning}\n\n${archiveWarning}\n\nThe work zero must be UNCHANGED since the original run. Continue?`;
}
