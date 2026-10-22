import type { ControllerKind } from '../../core/devices';
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

// ADR-180 Amendment 7 (controller audit v3 D4-P2-2): FluidNC never gets Pause
// and lift, and its door resume adds no delay of its own: Parking.cpp's unpark
// runs restore_spindle(), and the only wait is the spindle's YAML spinup_ms
// (Spindle.cpp spindleDelay, "@default 0", scaled by the RPM change). An RS485
// VFD that reports its speed is polled until it gets there. So by default the
// line continues while the bit is still speeding up in the cut.
// Settings: http://wiki.fluidnc.com/en/config/config_spindles (spinup_ms).
export const CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE =
  'KerfDesk does not lift the bit on FluidNC, so unless parking is on in the FluidNC config it ' +
  "is still in the cut. Resume restarts the spindle and waits only the spindle's spinup_ms " +
  'from the FluidNC config, which is 0 unless set (an RS485 VFD that reports its speed is ' +
  'waited for). With no wait, the bit is fed through the cut while it is still speeding up. ' +
  'Prefer ABORT JOB and recover from the ' +
  "Interrupted job card. To make Resume wait, set spinup_ms in the spindle's section of the " +
  'FluidNC config to its time to full speed (FluidNC wiki, Spindles).';

// FluidNC's $32 is a read-only mirror of a Laser spindle type, so the fix is
// the YAML spindle, not $32=0 (ADR-180 Amendment 6).
export const CNC_RESUME_FLUIDNC_LASER_MODE_ADVISORY_MESSAGE =
  "FluidNC's spindle is set up as a laser ($32=1), so Resume restarts motion at once with NO " +
  'spindle spin-up: the stopped bit is pushed through the cut. Prefer ABORT JOB and recover ' +
  'from the Interrupted job card, and configure a router spindle (not Laser) in the FluidNC ' +
  'config before cutting again.';

const CNC_PAUSE_MESSAGE =
  'Pause stops motion in place and switches the spindle off; position is kept and the ' +
  'job can be resumed. When the program allows it, KerfDesk then lifts the bit to safe ' +
  'height, so Resume spins up above the cut instead of in it. Use ABORT JOB or the ' +
  'physical E-stop if the cutter is unsafe.';

const CNC_PAUSE_FLUIDNC_MESSAGE =
  'Pause stops motion in place and switches the spindle off; position is kept and the ' +
  'job can be resumed. KerfDesk does not lift the bit on FluidNC, so it stays in the cut ' +
  'unless parking is on in the FluidNC config. Use ABORT JOB or the physical E-stop if the ' +
  'cutter is unsafe.';

// ADR-411: Pause and lift. While a lift exists the controller no longer holds
// the job, so the door-resume advice above does not apply.
export const CNC_LIFT_PHASE_MESSAGES: Readonly<Record<CncPauseLiftPhase, string>> = {
  lifting:
    'Pause and lift is raising the bit out of the cut. Use ABORT JOB or the physical E-stop ' +
    'if unsafe.',
  lifted:
    'The bit is lifted to safe height with the spindle off. Resume spins the spindle up there, ' +
    'waits the spin-up time, moves back over the stop point and feeds down into its own cut ' +
    'before the job continues.',
  entering:
    'Resume is spinning up above the cut and taking the bit back to where it stopped. Use ' +
    'ABORT JOB or the physical E-stop if unsafe.',
};

/**
 * Advisory shown beside a paused CNC job's Resume control. Informational only —
 * Resume is never gated on this (ADR-180 amendment, rule 7). Null for laser.
 * A Pause that left the bit in the cut says why first (ADR-411 Amendment 1).
 * FluidNC never lifts, so its advice stands alone (ADR-180 Amendment 7).
 */
export function cncResumeAdvisoryNotice(
  machineKind: MachineKind | null,
  laserModeEnabled: boolean | undefined,
  liftPhase: CncPauseLiftPhase | null = null,
  liftSkipReason: string | null = null,
  controllerKind: ControllerKind | null = null,
): string | null {
  if (machineKind !== 'cnc') return null;
  if (liftPhase !== null) return CNC_LIFT_PHASE_MESSAGES[liftPhase];
  if (controllerKind === 'fluidnc') return fluidncResumeAdvisory(laserModeEnabled);
  const doorResume = doorResumeAdvisory(laserModeEnabled);
  return liftSkipReason === null
    ? doorResume
    : `Pause did not lift the bit: ${liftSkipReason} Resume tries to lift it first. If it ` +
        `still cannot: ${doorResume}`;
}

function doorResumeAdvisory(laserModeEnabled: boolean | undefined): string {
  if (laserModeEnabled === undefined) return CNC_RESUME_UNCONFIRMED_MODE_MESSAGE;
  return laserModeEnabled === false
    ? CNC_RESUME_ADVISORY_MESSAGE
    : CNC_RESUME_LASER_MODE_ADVISORY_MESSAGE;
}

// An unconfirmed $32 gets the spin-up advice: it already says to abort.
function fluidncResumeAdvisory(laserModeEnabled: boolean | undefined): string {
  return laserModeEnabled === true
    ? CNC_RESUME_FLUIDNC_LASER_MODE_ADVISORY_MESSAGE
    : CNC_RESUME_FLUIDNC_ADVISORY_MESSAGE;
}

export function cncPauseMessage(
  machineKind: MachineKind | null,
  controllerKind: ControllerKind | null = null,
): string | null {
  if (machineKind !== 'cnc') return null;
  return controllerKind === 'fluidnc' ? CNC_PAUSE_FLUIDNC_MESSAGE : CNC_PAUSE_MESSAGE;
}
