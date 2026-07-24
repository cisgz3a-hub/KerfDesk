import type { MachineKind } from '../../core/scene';

// ADR-180 amendment (2026-07-24): same-session CNC Resume is one-click again.
// GRBL feed hold keeps the spindle commanded, so cycle-start continues the job
// (LightBurn / every GRBL sender behaves this way). Per CLAUDE.md rule 7 the
// former refusal is demoted to a passive advisory: it INFORMS the operator and
// never blocks Resume. The operator's real safeguards stay the physical E-stop
// and eyes on the machine.
export const CNC_RESUME_ADVISORY_MESSAGE =
  'Before Resume, confirm the spindle is still spinning and the cutter is clear. ' +
  'Feed hold keeps the spindle commanded, so Resume continues the job; if the spindle ' +
  'stopped during the hold, Abort instead and start a newly reviewed recovery job.';

const CNC_PAUSE_MESSAGE =
  'Pause applies feed hold; the spindle keeps spinning and the job can be resumed. ' +
  'Use ABORT JOB or the physical E-stop if the spindle stopped or the cutter is unsafe.';

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
