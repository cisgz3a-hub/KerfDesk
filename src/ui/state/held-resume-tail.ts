// A laser Resume that left grblHAL Idle at the end of a job (ADR-684). On
// builds before 20260928 the controller can still hold the paused move's
// tail and run it, with its laser power, at the next motion. KerfDesk records
// what it saw and warns; it blocks nothing. A reset (a new controller
// session) or any motion since retires the warning, for good: a Frame returns
// to where it started, so a warning read from the position alone came back
// after the very Frame that ran the tail (rolling audit v9 R8-P2-2).

import type { GrblState, StatusReport } from '../../core/controllers/grbl';
import {
  grblHalMayHoldResumeTail,
  HELD_RESUME_TAIL_MESSAGE,
} from '../../core/controllers/grblhal/held-resume-tail';
import { grblHalEvidence } from '../../core/controllers/grblhal/grblhal-evidence';
import type { ControllerDriver } from '../../core/controllers';
import { inferCurrentMachinePosition } from './infer-machine-position';
import type { HeldResumeTail } from './laser-pause-resume-transition';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';

const SAME_POSITION_MM = 0.001;

type Point = { readonly x: number; readonly y: number; readonly z: number };

type ResumeOutcome = {
  readonly laserJob: boolean;
  /** No stream bytes were left to send when Resume confirmed. */
  readonly finishedWithoutRefill: boolean;
  /** The state of the report that confirmed Resume. */
  readonly confirmedState: GrblState | null;
};

/** Wraps a Resume confirmation predicate and keeps the state of the first
 * report it accepts. */
export function recordConfirmedState(accept: (report: StatusReport) => boolean): {
  readonly accept: (report: StatusReport) => boolean;
  readonly state: () => GrblState | null;
} {
  let confirmed: GrblState | null = null;
  return {
    accept: (report) => {
      const accepted = accept(report);
      if (accepted) confirmed ??= report.state;
      return accepted;
    },
    state: () => confirmed,
  };
}

/** The patch that records a Resume grblHAL may have answered with a held
 * tail, or an empty patch when this Resume cannot have one. */
export function heldResumeTailPatch(
  state: LaserState,
  driver: Pick<ControllerDriver, 'kind' | 'realtime'>,
  outcome: ResumeOutcome,
): Partial<Pick<LaserState, 'heldResumeTail' | 'log'>> {
  const doorResume = driver.realtime.safetyDoor !== null;
  if (!outcome.laserJob || !doorResume || !outcome.finishedWithoutRefill) return {};
  if (outcome.confirmedState !== 'Idle') return {};
  const grblHal = driver.kind === 'grblhal' || grblHalEvidence(state) !== null;
  if (!grblHalMayHoldResumeTail({ grblHal, buildInfoLines: state.controllerBuildInfoRawLines })) {
    return {};
  }
  return {
    heldResumeTail: {
      sessionEpoch: state.controllerSessionEpoch,
      machinePosition: inferCurrentMachinePosition(state.statusReport, state.wcoCache),
      streamerEpoch: state.streamerEpoch,
    },
    log: pushLog(state, `[lf2] ${HELD_RESUME_TAIL_MESSAGE}`),
  };
}

/** The recorded tail while it can still be in the controller: same session,
 * and the machine has not moved since. */
export function currentHeldResumeTail(
  state: Pick<
    LaserState,
    'heldResumeTail' | 'controllerSessionEpoch' | 'connection' | 'statusReport' | 'wcoCache'
  >,
): HeldResumeTail | null {
  const tail = state.heldResumeTail ?? null;
  if (tail === null || state.connection.kind !== 'connected') return null;
  if (tail.sessionEpoch !== state.controllerSessionEpoch) return null;
  if (tail.machinePosition === null) return tail;
  const now = inferCurrentMachinePosition(state.statusReport, state.wcoCache);
  return now === null || samePoint(now, tail.machinePosition) ? tail : null;
}

/** Clears the recorded tail once motion has run it: a Frame or jog the
 * controller was sent, a later job, or a report away from the point where
 * Resume confirmed. Applied with every status report, so a Frame that comes
 * back to the same point, or a jog away and back, does not revive it. */
export function heldResumeTailRetirementPatch(
  state: Pick<LaserState, 'heldResumeTail' | 'motionOperation' | 'streamerEpoch'>,
  next: Pick<LaserState, 'statusReport' | 'wcoCache'>,
): Partial<Pick<LaserState, 'heldResumeTail'>> {
  const tail = state.heldResumeTail ?? null;
  if (tail === null) return {};
  const retired = { heldResumeTail: null };
  if (state.motionOperation?.dispatchComplete === true) return retired;
  if (tail.streamerEpoch !== undefined && tail.streamerEpoch !== state.streamerEpoch) {
    return retired;
  }
  if (tail.machinePosition === null) return {};
  const now = inferCurrentMachinePosition(next.statusReport, next.wcoCache);
  return now !== null && !samePoint(now, tail.machinePosition) ? retired : {};
}

function samePoint(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) <= SAME_POSITION_MM &&
    Math.abs(a.y - b.y) <= SAME_POSITION_MM &&
    Math.abs(a.z - b.z) <= SAME_POSITION_MM
  );
}
