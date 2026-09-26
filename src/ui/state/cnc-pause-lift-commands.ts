// cnc-pause-lift-commands (ADR-401) — the controller exchanges Pause and lift
// is built from. Every line goes out through the command arbiter, one at a
// time, and every step re-checks that the lift still owns the paused stream:
// Abort, an alarm, an uncommanded reboot or a lost port ends it between any
// two lines.

import type { ControllerDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import type { MotionPoint } from '../../core/job/motion-manifest';
import type { SerialConnection } from '../../platform/types';
import {
  ownsCncPauseLift,
  reportedMachinePositionMm,
  samePoint,
  type CncPauseLift,
} from './cnc-pause-lift-state';
import { waitForFreshControllerStatus } from './laser-controller-status-wait';
import { ControllerCommandRefusedError, startControllerCommand } from './laser-interactive-command';
import type { PostJobSettleRefs } from './laser-post-job-settle';
import { cncPauseLiftFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

export type CncPauseLiftContext = {
  readonly set: SetFn;
  readonly get: () => LaserState;
  readonly refs: PostJobSettleRefs & { readonly connection?: SerialConnection | null };
  readonly safeWrite: (
    line: string,
    action?: LaserSafetyAction,
    source?: TranscriptSource,
  ) => Promise<void>;
  readonly driver: () => ControllerDriver;
  readonly failDarkStop: () => Promise<void>;
};

const LINE_TIMEOUT_MS = 10_000;
const STATUS_TIMEOUT_MS = 8_000;
/** Wall-clock bound on one lift or re-entry move; an alarm, a reboot or a
 *  lost port ends the wait at once. */
const MOVE_TIMEOUT_MS = 60_000;

export class CncPauseLiftLostError extends Error {
  constructor() {
    super('Pause and lift no longer owns the paused job.');
    this.name = 'CncPauseLiftLostError';
  }
}

/** The controller answered one of the lift's own lines with `error:N`. */
export class CncLiftLineRefusedError extends Error {
  constructor(
    readonly line: string,
    raw: string,
  ) {
    super(`The controller refused "${line}" (${raw}).`);
    this.name = 'CncLiftLineRefusedError';
  }
}

export function assertOwnsCncPauseLift(context: CncPauseLiftContext, token: number): void {
  const state = context.get();
  if (!ownsCncPauseLift(state, token) || state.connection.kind !== 'connected') {
    throw new CncPauseLiftLostError();
  }
}

export async function sendCncLiftLine(
  context: CncPauseLiftContext,
  token: number,
  line: string,
  action: 'pause' | 'resume',
  timeoutMs = LINE_TIMEOUT_MS,
): Promise<void> {
  assertOwnsCncPauseLift(context, token);
  try {
    await startControllerCommand(context.refs, context.safeWrite, {
      kind: 'cnc-pause-lift',
      label: `Pause and lift (${line})`,
      command: `${line}\n`,
      action,
      // An owned line owes its own acknowledgement; 'job' would hand its `ok`
      // to the paused stream.
      source: 'system',
      timeoutMs,
    });
  } catch (error) {
    if (error instanceof ControllerCommandRefusedError) {
      throw new CncLiftLineRefusedError(line, error.message);
    }
    throw error;
  }
  assertOwnsCncPauseLift(context, token);
}

export async function waitForCncLiftStatus(
  context: CncPauseLiftContext,
  token: number,
  accept: (report: StatusReport) => boolean,
  timeoutMessage: string,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<StatusReport> {
  assertOwnsCncPauseLift(context, token);
  const state = context.get();
  const report = await waitForFreshControllerStatus(context.refs, {
    after: { sessionEpoch: state.controllerSessionEpoch, sequence: state.statusSequence },
    accept,
    timeoutMs,
    timeoutMessage,
  });
  assertOwnsCncPauseLift(context, token);
  return report;
}

/** Sends one move and waits until a fresh Idle report puts the bit on its
 *  target, in the lift's verified work frame. */
export async function moveCncLift(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
  line: string,
  target: Partial<MotionPoint>,
  action: 'pause' | 'resume',
): Promise<void> {
  await sendCncLiftLine(context, lift.token, line, action);
  await waitForCncLiftStatus(
    context,
    lift.token,
    (report) => report.state === 'Idle' && reportAtWorkTarget(context, lift, report, target),
    `The machine did not reach the position "${line}" commands.`,
    MOVE_TIMEOUT_MS,
  );
}

function reportAtWorkTarget(
  context: CncPauseLiftContext,
  lift: CncPauseLift,
  report: StatusReport,
  target: Partial<MotionPoint>,
): boolean {
  const machine = reportedMachinePositionMm(
    report,
    report.wco ?? context.get().wcoCache,
    lift.reportInches,
  );
  if (machine === null) return false;
  const work = {
    x: machine.x - lift.workOffsetMm.x,
    y: machine.y - lift.workOffsetMm.y,
    z: machine.z - lift.workOffsetMm.z,
  };
  return samePoint(work, target);
}

/**
 * Ends a lift that could not finish. After its soft reset the controller no
 * longer holds the job, so the job ends with the same reset Abort sends: the
 * spindle and any motion stop, and pass recovery takes over. A lift Abort or
 * an alarm already ended is only forgotten.
 */
export async function failCncPauseLift(
  context: CncPauseLiftContext,
  token: number,
  error: unknown,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof CncPauseLiftLostError || !ownsCncPauseLift(context.get(), token)) {
    context.set((state) => (state.cncPauseLift?.token === token ? { cncPauseLift: null } : {}));
    return;
  }
  context.set((state) => {
    const notice = cncPauseLiftFailedNotice(asSentence(reason));
    return {
      cncPauseLift: null,
      // First notice wins, except the generic one the refusal of the lift's
      // own line just raised: this one says what actually happened.
      safetyNotice: raisedByRefusal(state.safetyNotice, error)
        ? notice
        : (state.safetyNotice ?? notice),
      log: pushLog(state, `[lf2] Pause and lift stopped: ${reason}`),
    };
  });
  await context.failDarkStop().catch(() => undefined);
}

function raisedByRefusal(notice: LaserState['safetyNotice'], error: unknown): boolean {
  return (
    error instanceof CncLiftLineRefusedError &&
    notice?.kind === 'controller-error' &&
    notice.rejectedLine === error.line
  );
}

function asSentence(reason: string): string {
  const trimmed = reason.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
