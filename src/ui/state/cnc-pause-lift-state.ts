// cnc-pause-lift-state (ADR-411) — the store's record of a CNC "Pause and
// lift": which paused stream it belongs to, how far it got, and the controller
// evidence from before its soft reset that everything after the reset is
// checked against.

import {
  wipeInFlight,
  type OverrideValues,
  type StatusReport,
  type StreamerStatus,
} from '../../core/controllers/grbl';
import type { MotionPoint } from '../../core/job/motion-manifest';
import type { CncPauseReentryPlan } from '../../core/recovery/cnc-pause-reentry';
import type { LaserState, WorkOriginSource } from './laser-store';

/** 'lifting': reset, frame check and the Z lift are running. 'lifted': the
 *  bit is at safe height with the spindle off and Resume re-enters.
 *  'entering': Resume is spinning up and returning the bit to the cut. */
export type CncPauseLiftPhase = 'lifting' | 'lifted' | 'entering';

export type CncPauseLift = {
  readonly token: number;
  readonly phase: CncPauseLiftPhase;
  readonly streamerEpoch: number;
  /** Write epoch the lift's soft reset goes out in. The boot banner that
   *  closes it is the lift's own, not an uncommanded reboot; null once seen. */
  readonly resetWriteEpoch: number | null;
  readonly plan: CncPauseReentryPlan;
  readonly reportInches: boolean;
  /** Machine position of the settled pause, millimetres. */
  readonly machineMm: MotionPoint;
  /** Work offset (WCO) of the settled pause, millimetres. */
  readonly workOffsetMm: MotionPoint;
  readonly workOriginActive: boolean;
  readonly workOriginSource: WorkOriginSource;
  /** Feed, rapid and spindle overrides of the settled pause, when the
   *  controller reported them. The lift's reset puts them back to 100%. */
  readonly overrides: OverrideValues | null;
};

/**
 * What the current job's pauses learned about lifting it (ADR-411 Amendment
 * 1). A lift's own soft reset makes KerfDesk forget the controller settings
 * it read on connect until the job ends. The lift checked laser mode ($32)
 * and firmware parking before that reset. `$` settings and build options live
 * in the controller's non-volatile memory, a reset does not change them, and
 * setup lines are refused while a job is active, so a later Pause of the same
 * stream relies on that check.
 */
export type CncPauseLiftJob = {
  readonly streamerEpoch: number;
  /** Report units ($13) a lift of this job confirmed before its reset, or
   *  null while no lift of this job has reset the controller. */
  readonly confirmedReportInches: boolean | null;
  /** Why the latest Pause of this job left the bit in the cut, or null. */
  readonly skipReason: string | null;
};

/** The store's Pause and lift fields. Optional only so older hand-built test
 *  states remain valid. */
export type CncPauseLiftStoreState = {
  /** A CNC Pause that lifted the bit out of the cut, and the evidence its
   *  re-entry is checked against (ADR-411). Null when Pause stopped in place. */
  readonly cncPauseLift?: CncPauseLift | null;
  readonly cncPauseLiftJob?: CncPauseLiftJob | null;
};

const INCH_MM = 25.4;
/** How far a reported position or offset may move across the lift and still
 *  be the same frame: status reports carry 0.001 mm (0.0001 in). */
export const CNC_LIFT_POSITION_TOLERANCE_MM = 0.01;

let nextLiftToken = 1;

export function nextCncPauseLiftToken(): number {
  const token = nextLiftToken;
  nextLiftToken += 1;
  return token;
}

/** The lift still belongs to the paused stream it was started for. */
export function ownsCncPauseLift(state: LaserState, token: number): boolean {
  const lift = state.cncPauseLift ?? null;
  return (
    lift !== null &&
    lift.token === token &&
    state.streamer?.status === 'paused' &&
    state.streamerEpoch === lift.streamerEpoch
  );
}

/** A lift that belongs to the current paused stream, if any. */
export function currentCncPauseLift(state: LaserState): CncPauseLift | null {
  const lift = state.cncPauseLift ?? null;
  return lift !== null && ownsCncPauseLift(state, lift.token) ? lift : null;
}

/** Store selector: the phase of the current paused stream's lift, if any. */
export function cncPauseLiftPhase(state: LaserState): CncPauseLiftPhase | null {
  return currentCncPauseLift(state)?.phase ?? null;
}

/** The current stream's Pause and lift record, if any. */
export function currentCncPauseLiftJob(state: LaserState): CncPauseLiftJob | null {
  const job = state.cncPauseLiftJob ?? null;
  return job !== null && state.streamer !== null && job.streamerEpoch === state.streamerEpoch
    ? job
    : null;
}

/** The record after a Pause of the current stream decided whether to lift. */
export function cncPauseLiftJobPatch(
  state: LaserState,
  change: Partial<Omit<CncPauseLiftJob, 'streamerEpoch'>>,
): Pick<CncPauseLiftStoreState, 'cncPauseLiftJob'> {
  const job = currentCncPauseLiftJob(state) ?? {
    streamerEpoch: state.streamerEpoch,
    confirmedReportInches: null,
    skipReason: null,
  };
  return { cncPauseLiftJob: { ...job, ...change } };
}

/** Store selector: why the current paused stream's Pause left the bit in the
 *  cut, while no lift holds it. */
export function cncPauseLiftSkipReason(state: LaserState): string | null {
  if (state.streamer?.status !== 'paused' || currentCncPauseLift(state) !== null) return null;
  return currentCncPauseLiftJob(state)?.skipReason ?? null;
}

/** Store selector: laser mode ($32) as far as the current job knows it. A
 *  lift of this job confirmed it off before its own reset cleared the
 *  settings KerfDesk had read. */
export function cncJobLaserModeEnabled(state: LaserState): boolean | undefined {
  const read = state.controllerSettings?.laserModeEnabled;
  if (read !== undefined) return read;
  return currentCncPauseLiftJob(state)?.confirmedReportInches == null ? undefined : false;
}

/**
 * Whether the current paused stream's lift may be moving the bit. The lift
 * moves with its own lines while the stream stays paused, so a status report
 * one poll behind can still read Idle mid-move (ADR-215 Amendment 1).
 */
export function cncPauseLiftMayBeMoving(state: {
  readonly cncPauseLift?: CncPauseLift | null;
  readonly streamer: { readonly status: StreamerStatus } | null;
  readonly streamerEpoch: number;
}): boolean {
  const lift = state.cncPauseLift ?? null;
  return (
    lift !== null &&
    lift.phase !== 'lifted' &&
    lift.streamerEpoch === state.streamerEpoch &&
    state.streamer?.status === 'paused'
  );
}

/**
 * Whether a boot banner is the one the lift's own soft reset produced. Read
 * before the banner handler advances the write epoch.
 */
export function isOwnedCncPauseLiftReset(state: LaserState, writeEpochBefore: number): boolean {
  const lift = currentCncPauseLift(state);
  return lift !== null && lift.phase === 'lifting' && lift.resetWriteEpoch === writeEpochBefore;
}

/** The lift reset the controller at a settled hold on purpose: the paused
 *  stream survives, and its in-flight lines are gone with the RX buffer. */
export function ownedLiftResetPatch(
  state: LaserState,
): Partial<Pick<LaserState, 'cncPauseLift' | 'streamer'>> {
  const lift = state.cncPauseLift ?? null;
  return {
    cncPauseLift: lift === null ? null : { ...lift, resetWriteEpoch: null },
    ...(state.streamer === null ? {} : { streamer: wipeInFlight(state.streamer) }),
  };
}

export function reportedMachinePositionMm(
  report: StatusReport,
  workOffset: StatusReport['wco'] | null,
  reportInches: boolean,
): MotionPoint | null {
  if (report.mPos !== null) return scaled(report.mPos, reportInches);
  if (report.wPos === null || workOffset == null) return null;
  const wpos = scaled(report.wPos, reportInches);
  const wco = scaled(workOffset, reportInches);
  return { x: wpos.x + wco.x, y: wpos.y + wco.y, z: wpos.z + wco.z };
}

export function scaled(point: MotionPoint, reportInches: boolean): MotionPoint {
  const factor = reportInches ? INCH_MM : 1;
  return { x: point.x * factor, y: point.y * factor, z: point.z * factor };
}

export function samePoint(
  a: MotionPoint,
  b: Partial<MotionPoint>,
  tolerance = CNC_LIFT_POSITION_TOLERANCE_MM,
): boolean {
  return (
    (b.x === undefined || Math.abs(a.x - b.x) <= tolerance) &&
    (b.y === undefined || Math.abs(a.y - b.y) <= tolerance) &&
    (b.z === undefined || Math.abs(a.z - b.z) <= tolerance)
  );
}

export function workPositionOf(lift: CncPauseLift, machine: MotionPoint): MotionPoint {
  return {
    x: machine.x - lift.workOffsetMm.x,
    y: machine.y - lift.workOffsetMm.y,
    z: machine.z - lift.workOffsetMm.z,
  };
}
