import type { MachineKind } from '../../core/scene';

// ADR-180 amendment 2 (2026-07-25): CNC Pause now uses GRBL's safety-door byte
// rather than a bare feed hold, so the machine stops in place AND the controller
// de-energizes the spindle. Resume restores the spindle and holds motion for
// SAFETY_DOOR_SPINDLE_DELAY (4.0s in stock grbl config.h) before continuing the
// interrupted line. These strings previously told the operator the spindle keeps
// spinning, which is now false. Per CLAUDE.md rule 7 both INFORM and never block.
export const CNC_RESUME_ADVISORY_MESSAGE =
  'Resume restarts the spindle, waits for it to reach speed, then continues the same ' +
  'line from where it stopped. The cutter is still in the cut, so it spins back up ' +
  'engaged — on a deep or full-width pass, check the bit before resuming.';

const CNC_PAUSE_MESSAGE =
  'Pause stops motion in place and switches the spindle off; position is kept and the ' +
  'job can be resumed. Use ABORT JOB or the physical E-stop if the cutter is unsafe.';

/**
 * Advisory shown beside a paused CNC job's Resume control. Informational only —
 * Resume is never gated on this (ADR-180 amendment, rule 7). Null for laser.
 */
export function cncResumeAdvisoryNotice(machineKind: MachineKind | null): string | null {
  return machineKind === 'cnc' ? CNC_RESUME_ADVISORY_MESSAGE : null;
}

export function cncPauseMessage(machineKind: MachineKind | null): string | null {
  return machineKind === 'cnc' ? CNC_PAUSE_MESSAGE : null;
}
