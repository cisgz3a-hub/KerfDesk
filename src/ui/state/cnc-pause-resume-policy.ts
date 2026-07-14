import type { MachineKind } from '../../core/scene';

export const CNC_RESUME_MANUAL_RECOVERY_MESSAGE =
  'CNC Resume is blocked because KerfDesk cannot prove the spindle stayed turning while the cutter may be engaged. Request ABORT, inspect and clear the cutter with a machine-specific procedure, then start a newly reviewed recovery job.';

const CNC_PAUSE_TERMINAL_MESSAGE =
  'Pause applies feed hold, but this CNC job cannot be resumed automatically. Request ABORT and follow a machine-specific manual recovery procedure after the hold.';

export function cncResumeBlockMessage(machineKind: MachineKind | null): string | null {
  return machineKind === 'cnc' ? CNC_RESUME_MANUAL_RECOVERY_MESSAGE : null;
}

export function cncPauseMessage(machineKind: MachineKind | null): string | null {
  return machineKind === 'cnc' ? CNC_PAUSE_TERMINAL_MESSAGE : null;
}
