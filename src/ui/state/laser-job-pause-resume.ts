import type { ControllerDriver } from '../../core/controllers';
import {
  pause as pauseStreamer,
  resume as resumeStreamer,
  step,
  type StatusReport,
} from '../../core/controllers/grbl';
import {
  cancelFreshControllerStatusWait,
  waitForFreshControllerStatus,
} from './laser-controller-status-wait';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import {
  assertPauseResumeTransitionOwner,
  beginPauseResumeTransition,
  completePauseResumeTransition,
  failDarkWasAlreadyRequested,
  type PauseResumeTransitionAction,
  type PauseResumeTransitionToken,
} from './laser-pause-resume-transition';
import { streamStalledNotice, type LaserSafetyAction } from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { pushLog } from './laser-store-helpers';
import { liveCanvasLifecyclePatch } from './live-canvas-run';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;

type PauseResumeContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: ControllerLifecycleRefs;
  readonly safeWrite: SafeWriteFn;
  readonly driver: () => ControllerDriver;
  readonly failDarkStop: () => Promise<void>;
};

const PAUSE_REQUIRES_LASER_MODE_MESSAGE =
  'Pause requires confirmed GRBL laser mode ($32=1). Request ABORT instead; feed hold can leave the laser on when $32=0 or unknown. Use the physical E-stop if unsafe.';
const PAUSE_UNSUPPORTED_MESSAGE =
  'This controller has no realtime pause command. Pause is stream-side only: sending stops, but buffered motion finishes. Request ABORT, or use the physical E-stop if unsafe.';
const PAUSE_CONFIRMATION_TIMEOUT_MESSAGE =
  'Pause did not complete within the controller safety deadline. KerfDesk froze the stream and requested a fail-dark controller reset; use physical E-stop if the machine did not stop.';
const RESUME_CONFIRMATION_TIMEOUT_MESSAGE =
  'Resume did not complete within the controller safety deadline. KerfDesk froze the stream and requested a fail-dark controller reset; use physical E-stop if the machine state is uncertain.';

export async function runConfirmedPauseJob(context: PauseResumeContext): Promise<void> {
  assertNoPauseResumeTransition(context);
  const activeDriver = context.driver();
  const laserJob = context.get().activeJobMachineKind !== 'cnc';
  // ADR-180 amendment 2 (2026-07-25): CNC Pause now takes the same safety-door
  // byte as laser instead of a bare feed hold. GRBL's Door state decelerates in
  // place and de-energizes spindle and coolant; door-resume restores them and
  // waits SAFETY_DOOR_SPINDLE_DELAY (4.0s in stock config.h) before motion
  // continues, so the job carries on mid-line at full RPM. Feed hold cannot do
  // this — it stops motion only and leaves the spindle commanded.
  const safetyDoor = activeDriver.realtime.safetyDoor;
  const pauseByte = safetyDoor ?? activeDriver.realtime.hold;
  const controlSession = context.get().controllerSessionEpoch;

  if (
    laserJob &&
    safetyDoor === null &&
    pauseByte !== null &&
    activeDriver.capabilities.settings !== 'none'
  ) {
    assertPauseSafe(context);
  }
  if (pauseByte === null) {
    freezeStreamer(context);
    context.get().pushSystemNotice(`[lf2] ${PAUSE_UNSUPPORTED_MESSAGE}`);
    return;
  }
  await runOwnedPauseResumeTransition(
    context,
    'pause',
    PAUSE_CONFIRMATION_TIMEOUT_MESSAGE,
    async (token) => {
      freezeStreamer(context);
      if (safetyDoor !== null) {
        await sendRealtimeAndConfirm(
          context,
          token,
          pauseByte,
          controlSession,
          (report) => isSettledWithAccessoriesOff(report, laserJob),
          PAUSE_CONFIRMATION_TIMEOUT_MESSAGE,
          'pause',
        );
        assertCurrentPauseConfirmation(context, laserJob);
      } else {
        await writeWhileTransitionOwner(context, token, pauseByte, 'pause');
      }
    },
  );
}

export async function runConfirmedResumeJob(context: PauseResumeContext): Promise<void> {
  assertNoPauseResumeTransition(context);
  // ADR-180 amendment 2 (2026-07-25): Resume is door-confirmed whenever the
  // driver has a door byte, for CNC as well as laser — Pause parked via Door, so
  // Resume must wait for the controller to report Run/Idle before the stream is
  // refilled. GRBL restores spindle and coolant on door-resume and holds motion
  // for SAFETY_DOOR_SPINDLE_DELAY (4.0s stock) so the cutter is back at speed
  // before the interrupted move continues.
  const activeDriver = context.driver();
  const confirmedDoorResume = activeDriver.realtime.safetyDoor !== null;
  const controlSession = context.get().controllerSessionEpoch;
  const resumeByte = activeDriver.realtime.resume;

  await runOwnedPauseResumeTransition(
    context,
    'resume',
    RESUME_CONFIRMATION_TIMEOUT_MESSAGE,
    async (token) => {
      if (resumeByte !== null && confirmedDoorResume) {
        await sendRealtimeAndConfirm(
          context,
          token,
          resumeByte,
          controlSession,
          (report) => report.state === 'Run' || report.state === 'Idle',
          RESUME_CONFIRMATION_TIMEOUT_MESSAGE,
          'resume',
        );
        assertCurrentResumeConfirmation(context);
      } else if (resumeByte !== null) {
        await writeWhileTransitionOwner(context, token, resumeByte, 'resume');
      }
      await refillResumedStream(context, token);
    },
  );
}

function freezeStreamer(context: PauseResumeContext): void {
  context.set((state) =>
    state.streamer === null
      ? {}
      : {
          streamer: pauseStreamer(state.streamer),
          ...liveCanvasLifecyclePatch(state, 'paused'),
        },
  );
}

async function runOwnedPauseResumeTransition(
  context: PauseResumeContext,
  action: PauseResumeTransitionAction,
  timeoutMessage: string,
  work: (token: PauseResumeTransitionToken) => Promise<void>,
): Promise<void> {
  const owner = beginPauseResumeTransition(context.refs, action, timeoutMessage);
  const transitionWork = work(owner.token);
  try {
    await Promise.race([transitionWork, owner.deadline]);
    assertPauseResumeTransitionOwner(context.refs, owner.token);
    completePauseResumeTransition(context.refs, owner.token);
  } catch (error) {
    const failDarkAlreadyOwned = failDarkWasAlreadyRequested(error, owner.token);
    completePauseResumeTransition(context.refs, owner.token);
    const failure = recordConfirmationFailure(context, error);
    cancelFreshControllerStatusWait(context.refs, failure.message);
    if (!failDarkAlreadyOwned) requestFailDarkStop(context);
    throw failure;
  }
}

async function writeWhileTransitionOwner(
  context: PauseResumeContext,
  token: PauseResumeTransitionToken,
  command: string,
  action: PauseResumeTransitionAction,
): Promise<void> {
  await context.safeWrite(command, action);
  assertPauseResumeTransitionOwner(context.refs, token);
}

function requestFailDarkStop(context: PauseResumeContext): void {
  context.set((state) => ({ safetyNotice: state.safetyNotice ?? streamStalledNotice() }));
  void context.failDarkStop().catch(() => undefined);
}

async function sendRealtimeAndConfirm(
  context: PauseResumeContext,
  token: PauseResumeTransitionToken,
  command: string,
  expectedSession: number,
  accept: (report: StatusReport) => boolean,
  timeoutMessage: string,
  action: 'pause' | 'resume',
): Promise<void> {
  const state = context.get();
  if (state.controllerSessionEpoch !== expectedSession) {
    throw new Error('Controller session changed before confirmation.');
  }
  const statusQuery = context.driver().realtime.statusQuery;
  if (statusQuery === null) {
    throw new Error('Controller has no realtime status query.');
  }
  await writeWhileTransitionOwner(context, token, command, action);
  const afterCommand = context.get();
  if (afterCommand.controllerSessionEpoch !== expectedSession) {
    throw new Error('Controller session changed before the status query.');
  }
  // A reply to an older background `?` can arrive while the realtime command
  // write is pending. Only a report observed after that write settles may
  // prove this transition; arm before our own query so its immediate reply is
  // still captured.
  const confirmation = waitForFreshControllerStatus(context.refs, {
    after: { sessionEpoch: expectedSession, sequence: afterCommand.statusSequence },
    accept,
    timeoutMessage,
  });
  await Promise.all([writeWhileTransitionOwner(context, token, statusQuery, action), confirmation]);
  assertPauseResumeTransitionOwner(context.refs, token);
  if (context.get().controllerSessionEpoch !== expectedSession) {
    throw new Error('Controller session changed during confirmation.');
  }
}

function isSettledWithAccessoriesOff(report: StatusReport, requireProof: boolean): boolean {
  const settled =
    (report.state === 'Door' && (report.subState === 0 || report.subState === 1)) ||
    (report.state === 'Hold' && report.subState === 0);
  return settled && accessoriesAreOff(report.accessories, requireProof);
}

function assertCurrentPauseConfirmation(context: PauseResumeContext, requireProof: boolean): void {
  const state = context.get();
  const report = state.statusReport;
  const settled =
    report !== null &&
    ((report.state === 'Door' && (report.subState === 0 || report.subState === 1)) ||
      (report.state === 'Hold' && report.subState === 0));
  if (settled && accessoriesAreOff(state.accessoryCache, requireProof)) return;
  throw new Error(PAUSE_CONFIRMATION_TIMEOUT_MESSAGE);
}

function assertCurrentResumeConfirmation(context: PauseResumeContext): void {
  const state = context.get().statusReport?.state;
  if (state === 'Run' || state === 'Idle') return;
  throw new Error(RESUME_CONFIRMATION_TIMEOUT_MESSAGE);
}

function accessoriesAreOff(
  accessories: StatusReport['accessories'] | undefined,
  requireProof: boolean,
): boolean {
  if (accessories === null || accessories === undefined) {
    // GRBL omits the `A:` field when nothing is energized and emits `Ov:` only
    // periodically, so a CNC controller can settle into Door before any report
    // carries accessory data at all. A settled Door state is itself the
    // controller reporting it de-energized spindle and coolant, so demanding the
    // field would time out and fail-dark a job that stopped correctly — losing a
    // recoverable run. The laser path still requires positive proof the beam is
    // off (ADR-179), where a stuck-on beam is the hazard.
    return !requireProof;
  }
  return (
    !accessories.spindleCw && !accessories.spindleCcw && !accessories.flood && !accessories.mist
  );
}

function assertNoPauseResumeTransition(context: PauseResumeContext): void {
  if (context.refs.controllerStatusWait == null && context.refs.pauseResumeTransition == null)
    return;
  throw recordConfirmationFailure(
    context,
    'Pause or Resume is already waiting for controller confirmation.',
  );
}

function assertPauseSafe(context: PauseResumeContext): void {
  if (context.get().controllerSettings?.laserModeEnabled === true) return;
  context.set({
    lastWriteError: PAUSE_REQUIRES_LASER_MODE_MESSAGE,
    log: pushLog(context.get(), `[lf2] Pause blocked: ${PAUSE_REQUIRES_LASER_MODE_MESSAGE}`),
  });
  throw new Error(PAUSE_REQUIRES_LASER_MODE_MESSAGE);
}

function recordConfirmationFailure(context: PauseResumeContext, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  context.set({
    lastWriteError: message,
    log: pushLog(context.get(), `[lf2] Controller status confirmation failed: ${message}`),
  });
  return error instanceof Error ? error : new Error(message);
}

async function refillResumedStream(
  context: PauseResumeContext,
  token: PauseResumeTransitionToken,
): Promise<void> {
  assertPauseResumeTransitionOwner(context.refs, token);
  let toSend = '';
  context.set((state) => {
    if (state.streamer === null) return state;
    const stepped = step(resumeStreamer(state.streamer));
    toSend = stepped.toSend;
    return { streamer: stepped.state, ...liveCanvasLifecyclePatch(state, 'running') };
  });
  if (toSend.length === 0) return;
  await writeWhileTransitionOwner(context, token, toSend, 'resume');
}
