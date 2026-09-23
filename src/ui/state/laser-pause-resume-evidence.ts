// laser-pause-resume-evidence — what one controller status report proves about
// a Pause or Resume transition. Pause, Resume and their liveness policies read
// the same predicates, so a firmware's numbering is decided in one place.

import type { StatusReport } from '../../core/controllers/grbl';
import type { LaserSafetyNotice } from './laser-safety-notice';

type Accessories = StatusReport['accessories'];

/**
 * How recent the controller's settled door report must be when a laser Resume
 * deadline expires for the job to be kept. Four 250 ms status polls: long
 * enough to span a dropped reply, short enough that a controller which went
 * silent after accepting cycle start is still treated as silent.
 */
export const DOOR_HOLD_REPORT_MAX_AGE_MS = 1_000;

export const LASER_RESUME_DOOR_HELD_MESSAGE =
  'Resume was not accepted: the controller still reports its safety-door hold with the laser off ' +
  '(Door:1 means its door or lid input is open). Close the door or lid, then press Resume again. ' +
  'KerfDesk kept the job and froze the stream; no controller reset was requested.';

/** A settled stop: Door:0 (closed, ready), Door:1 (ajar) or Hold:0 (complete). */
export function isSettledPauseState(report: StatusReport | null): boolean {
  if (report === null) return false;
  if (report.state === 'Door') return report.subState === 0 || report.subState === 1;
  return report.state === 'Hold' && report.subState === 0;
}

/**
 * Controller-commanded laser/spindle output is off. Coolant is not part of
 * this proof: grblHAL can keep M8/M7 running through a door stop
 * (`$61` keep-coolant option; state_machine.c state_await_hold() clears
 * coolant only when `!settings.safety_door.flags.keep_coolant_on`), and on a
 * laser that output is air assist, not the beam ADR-179 guards.
 * https://github.com/grblHAL/core/blob/master/state_machine.c
 */
export function spindleIsOff(accessories: Accessories | undefined, requireProof: boolean): boolean {
  if (accessories === null || accessories === undefined) {
    // GRBL omits the `A:` field when nothing is energized and emits `Ov:` only
    // periodically, so a CNC controller can settle into Door before any report
    // carries accessory data at all. A settled Door state is itself the
    // controller reporting it de-energized the spindle, so demanding the field
    // would time out a job that stopped correctly. The laser path still
    // requires positive proof the beam is off (ADR-179), where a stuck-on beam
    // is the hazard.
    return !requireProof;
  }
  return !accessories.spindleCw && !accessories.spindleCcw;
}

export function coolantIsOn(accessories: Accessories | undefined): boolean {
  return accessories?.flood === true || accessories?.mist === true;
}

export function isSettledWithSpindleOff(report: StatusReport, requireProof: boolean): boolean {
  return isSettledPauseState(report) && spindleIsOff(report.accessories, requireProof);
}

/**
 * Door substates that are genuine progress toward the requested transition.
 * Pause: Door:2, the controller still retracting or decelerating. Resume: the
 * restore phase after cycle start, which GRBL 1.1 and FluidNC report as
 * Door:3 and grblHAL as Door:4 (`Parking_Resuming`; its report prints
 * `sys.parking_state` and never assigns `Parking_Cancel`, 3).
 * https://github.com/gnea/grbl/blob/master/grbl/report.c
 * https://github.com/grblHAL/core/blob/master/system.h
 */
export function isDoorTransitionProgress(
  report: StatusReport,
  action: 'pause' | 'resume',
): boolean {
  if (report.state !== 'Door') return false;
  if (action === 'pause') return report.subState === 2;
  return report.subState === 3 || report.subState === 4;
}

export type ControllerDoorHoldTracker = {
  /** Sees every fresh same-session report after the cycle-start write settled. */
  readonly observe: (report: StatusReport) => void;
  /** The controller is responsive and still parked in a beam-off door hold. */
  readonly isHeld: () => boolean;
};

/**
 * GRBL, grblHAL and FluidNC ignore cycle start while the door input is open
 * and do not remember it, so a laser Resume sent then never confirms although
 * the controller is answering every poll with a de-energized Door state. That
 * is a refusal, not silence: the fail-dark reset (ADR-179/212) would destroy a
 * recoverable job for no safety gain. Only a report that is recent, settled
 * and proves the beam off counts; anything else keeps the reset.
 * https://github.com/gnea/grbl/blob/master/grbl/protocol.c (EXEC_CYCLE_START)
 */
export function trackControllerDoorHold(
  readAccessoryCache: () => Accessories | undefined,
  now: () => number = Date.now,
): ControllerDoorHoldTracker {
  let latest: { readonly held: boolean; readonly at: number } | null = null;
  return {
    observe: (report) => {
      const settledDoor =
        report.state === 'Door' && (report.subState === 0 || report.subState === 1);
      latest = {
        held: settledDoor && spindleIsOff(report.accessories ?? readAccessoryCache(), true),
        at: now(),
      };
    },
    isHeld: () =>
      latest !== null && latest.held && now() - latest.at <= DOOR_HOLD_REPORT_MAX_AGE_MS,
  };
}

export function controllerDoorHeldNotice(): LaserSafetyNotice {
  return { kind: 'stream-stalled', message: LASER_RESUME_DOOR_HELD_MESSAGE };
}
