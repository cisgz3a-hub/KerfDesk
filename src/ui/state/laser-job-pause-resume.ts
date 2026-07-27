import type { ControllerDriver } from '../../core/controllers';
import { pause as pauseStreamer, type StatusReport } from '../../core/controllers/grbl';
import { cancelFreshControllerStatusWait } from './laser-controller-status-wait';
import {
  sendRealtimeAndConfirmPauseResume,
  writeWhilePauseResumeOwner,
} from './laser-pause-resume-confirmation';
import { refillResumedStream } from './laser-pause-resume-refill';
import {
  assertPauseResumeTransitionOwner,
  beginPauseResumeTransition,
  completePauseResumeTransition,
  failDarkWasAlreadyRequested,
  type PauseResumeTransitionAction,
  type PauseResumeTransitionToken,
} from './laser-pause-resume-transition';
import {
  assertNoPauseResumeTransition,
  recordPauseResumeConfirmationFailure,
  reportedPauseResumeFailure,
} from './laser-pause-resume-failure';
import { beginPostJobSettle, type PostJobSettleRefs } from './laser-post-job-settle';
import {
  cncPauseResumeStalledNotice,
  streamStalledNotice,
  type LaserSafetyAction,
} from './laser-safety-notice';
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
  readonly refs: PostJobSettleRefs;
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
// ADR-180 amendment 3 (2026-07-25): a CNC confirmation timeout must not escalate
// to a fail-dark reset, so its copy must not claim one was requested.
const CNC_PAUSE_CONFIRMATION_TIMEOUT_MESSAGE =
  'Pause did not confirm within the controller safety deadline. The stream is frozen and the job is kept — no controller reset was requested. Check the machine; use ABORT JOB or the physical E-stop if the spindle or cutter is unsafe.';
const CNC_RESUME_CONFIRMATION_TIMEOUT_MESSAGE =
  'Resume did not confirm within the controller safety deadline. The job is kept and the stream stays frozen — no controller reset was requested. Press Resume again, or use ABORT JOB if the machine state is uncertain.';

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
  const timeoutMessage = laserJob
    ? PAUSE_CONFIRMATION_TIMEOUT_MESSAGE
    : CNC_PAUSE_CONFIRMATION_TIMEOUT_MESSAGE;

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
  await runOwnedPauseResumeTransition(context, 'pause', timeoutMessage, async (token) => {
    freezeStreamer(context);
    if (safetyDoor !== null) {
      await sendRealtimeAndConfirmPauseResume(context, {
        token,
        command: pauseByte,
        expectedSession: controlSession,
        accept: (report) => isSettledWithAccessoriesOff(report, laserJob),
        timeoutMessage,
        action: 'pause',
        liveness: laserJob ? 'none' : 'cnc-door',
      });
      assertCurrentPauseConfirmation(context, laserJob);
    } else {
      await writeWhilePauseResumeOwner(context, {
        token,
        command: pauseByte,
        action: 'pause',
      });
    }
  });
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
  const laserJob = context.get().activeJobMachineKind !== 'cnc';
  const confirmedDoorResume = activeDriver.realtime.safetyDoor !== null;
  const controlSession = context.get().controllerSessionEpoch;
  const resumeByte = activeDriver.realtime.resume;
  const timeoutMessage = laserJob
    ? RESUME_CONFIRMATION_TIMEOUT_MESSAGE
    : CNC_RESUME_CONFIRMATION_TIMEOUT_MESSAGE;
  let finishedWithoutRefill = false;

  await runOwnedPauseResumeTransition(context, 'resume', timeoutMessage, async (token) => {
    if (resumeByte !== null && confirmedDoorResume) {
      await sendRealtimeAndConfirmPauseResume(context, {
        token,
        command: resumeByte,
        expectedSession: controlSession,
        accept: (report) => report.state === 'Run' || report.state === 'Idle',
        timeoutMessage,
        action: 'resume',
        liveness: laserJob ? 'none' : 'cnc-door',
      });
      assertCurrentResumeConfirmation(context);
    } else if (resumeByte !== null) {
      await writeWhilePauseResumeOwner(context, {
        token,
        command: resumeByte,
        action: 'resume',
      });
    }
    finishedWithoutRefill = await refillResumedStream(context, {
      token,
      liveness: !laserJob && confirmedDoorResume ? 'cnc-door' : 'none',
    });
  });
  if (finishedWithoutRefill) {
    beginPostJobSettle(context.set, context.get, context.refs, context.safeWrite);
  }
}

function freezeStreamer(context: PauseResumeContext): void {
  context.set((state) => {
    if (state.streamer === null) return {};
    const pausedStreamer = pauseStreamer(state.streamer);
    if (pausedStreamer === state.streamer && state.streamer.status !== 'paused') return {};
    return {
      streamer: pausedStreamer,
      ...liveCanvasLifecyclePatch(state, 'paused'),
    };
  });
}

async function runOwnedPauseResumeTransition(
  context: PauseResumeContext,
  action: PauseResumeTransitionAction,
  timeoutMessage: string,
  work: (token: PauseResumeTransitionToken) => Promise<void>,
): Promise<void> {
  const owner = beginPauseResumeTransition(context.refs, action, timeoutMessage);
  context.set({
    pauseResumeTransition: { token: owner.token.id, action },
  });
  const transitionWork = work(owner.token);
  try {
    await Promise.race([transitionWork, owner.deadline]);
    assertPauseResumeTransitionOwner(context.refs, owner.token);
    completePauseResumeTransition(context.refs, owner.token);
  } catch (error) {
    const failDarkAlreadyOwned = failDarkWasAlreadyRequested(error, owner.token);
    completePauseResumeTransition(context.refs, owner.token);
    // A Resume can fail while its first post-confirmation stream write is still
    // pending. Keep its staged queue/in-flight accounting, but make the host
    // sender paused again before surfacing the failure so an early or late ack
    // cannot refill beyond the failed transition.
    freezeStreamer(context);
    const failure = recordPauseResumeConfirmationFailure(
      context,
      reportedPauseResumeFailure(context, error),
    );
    cancelFreshControllerStatusWait(context.refs, failure.message);
    // ADR-180 amendment 3 (2026-07-25): only a laser escalates to a fail-dark
    // reset. On a laser a stuck-on beam is the hazard, so resetting the
    // controller is the correct response (ADR-179). On a router the Door state
    // has already de-energized the spindle, and a soft reset would destroy a
    // recoverable job — turning a missed confirmation into a scrapped workpiece.
    // The notice still surfaces; the stream stays frozen; the operator decides.
    if (!failDarkAlreadyOwned) recordPauseResumeStall(context);
    throw failure;
  } finally {
    clearPauseResumeTransitionState(context, owner.token);
  }
}

function recordPauseResumeStall(context: PauseResumeContext): void {
  const cncJob = context.get().activeJobMachineKind === 'cnc';
  context.set((state) => ({
    safetyNotice:
      state.safetyNotice ?? (cncJob ? cncPauseResumeStalledNotice() : streamStalledNotice()),
  }));
  if (cncJob) return;
  void context.failDarkStop().catch(() => undefined);
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

function clearPauseResumeTransitionState(
  context: PauseResumeContext,
  token: PauseResumeTransitionToken,
): void {
  context.set((state) =>
    state.pauseResumeTransition?.token === token.id ? { pauseResumeTransition: null } : {},
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
