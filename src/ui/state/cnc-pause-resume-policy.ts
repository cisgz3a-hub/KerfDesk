import type { MachineKind } from '../../core/scene';
import type { CncPauseLiftPhase } from './cnc-pause-lift-state';

// ADR-180 amendment 2 (2026-07-25): CNC Pause now uses GRBL's safety-door byte
// rather than a bare feed hold, so the machine stops in place AND the controller
// de-energizes the spindle. Resume restores the spindle and holds motion for
// SAFETY_DOOR_SPINDLE_DELAY (4.0s in stock grbl config.h) before continuing the
// interrupted line. These strings previously told the operator the spindle keeps
// spinning, which is now false. Per CLAUDE.md rule 7 both INFORM and never block.
export const CNC_RESUME_ADVISORY_MESSAGE =
  'Resume restarts the spindle, waits a fixed spin-up delay (4 s in stock GRBL), then ' +
  'continues the same line from where it stopped. The cutter is still in the cut, so it ' +
  'spins back up engaged — on a deep or full-width pass, check the bit before resuming.';

// CNC audit MC-1: with laser mode on ($32=1) GRBL and grblHAL skip that restore
// delay ("When in laser mode, ignore spindle spin-up delay", protocol.c): motion
// restarts the instant power returns, pushing a stopped bit through the cut. So
// the advice above holds only when the controller has confirmed $32=0.
export const CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE =
  'Laser mode ($32) is on, so Resume restarts motion at once with NO ' +
  'spindle spin-up: the stopped bit is pushed through the cut. Prefer ABORT JOB and recover ' +
  'from the Interrupted job card, and set $32=0 before cutting again.';

const CNC_RESUME_UNCONFIRMED_MODE_MESSAGE =
  'Controller laser mode ($32) is unconfirmed; Resume may restart motion without spindle spin-up. ' +
  'Verify $32=0 before resuming, or use ABORT JOB and recover from the Interrupted job card.';

const CNC_PAUSE_MESSAGE =
  'Pause stops motion in place and switches the spindle off; position is kept and the ' +
  'job can be resumed. When the program allows it, KerfDesk then lifts the bit to safe ' +
  'height, so Resume spins up above the cut instead of in it. Use ABORT JOB or the ' +
  'physical E-stop if the cutter is unsafe.';

// ADR-410: Pause and lift. While a lift exists the controller no longer holds
// the job, so the door-resume advice above does not apply.
export const CNC_LIFT_PHASE_MESSAGES: Readonly<Record<CncPauseLiftPhase, string>> = {
  lifting:
    'Pause and lift is raising the bit out of the cut. Use ABORT JOB or the physical E-stop ' +
    'if unsafe.',
  lifted:
    'The bit is lifted to safe height with the spindle off. Resume spins the spindle up there, ' +
    "waits the program's spin-up dwell, moves back over the stop point and feeds down into " +
    'its own cut before the job continues.',
  entering:
    'Resume is spinning up above the cut and taking the bit back to where it stopped. Use ' +
    'ABORT JOB or the physical E-stop if unsafe.',
};

/**
 * Advisory shown beside a paused CNC job's Resume control. Informational only —
 * Resume is never gated on this (ADR-180 amendment, rule 7). Null for laser.
 */
export function cncResumeAdvisoryNotice(
  machineKind: MachineKind | null,
  laserModeEnabled: boolean | undefined,
  liftPhase: CncPauseLiftPhase | null = null,
): string | null {
  if (machineKind !== 'cnc') return null;
  if (liftPhase !== null) return CNC_LIFT_PHASE_MESSAGES[liftPhase];
  if (laserModeEnabled === undefined) return CNC_RESUME_UNCONFIRMED_MODE_MESSAGE;
  return laserModeEnabled === false
    ? CNC_RESUME_ADVISORY_MESSAGE
    : CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE;
}

export function cncPauseMessage(machineKind: MachineKind | null): string | null {
  return machineKind === 'cnc' ? CNC_PAUSE_MESSAGE : null;
}
