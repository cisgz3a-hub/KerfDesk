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
  return `Review resume from requested line ${requestedLine}:\n\n${details}\n\nThe work zero must be UNCHANGED since the original run. Continue?`;
}
