import type { ControllerDriver } from '../../core/controllers';
import { pause as pauseStreamer } from '../../core/controllers/grbl';
import { cancelFreshControllerStatusWait } from './laser-controller-status-wait';
import {
  sendRealtimeAndConfirmPauseResume,
  writeWhilePauseResumeOwner,
} from './laser-pause-resume-confirmation';
import { refillResumedStream } from './laser-pause-resume-refill';
import {
  controllerDoorHeldNotice,
  coolantIsOn,
  isSettledPauseState,
  isSettledWithSpindleOff,
  LASER_RESUME_DOOR_HELD_MESSAGE,
  spindleIsOff,
  trackControllerDoorHold,
} from './laser-pause-resume-evidence';
import {
  assertPauseResumeTransitionOwner,
  beginPauseResumeTransition,
  completePauseResumeTransition,
  failDarkWasAlreadyRequested,
  hasCurrentPauseResumeTransportFence,
  ownsPauseResumeTransition,
  isPauseResumeDeadlineError,
  type PauseResumeTransitionAction,
  type PauseResumeTransitionToken,
} from './laser-pause-resume-transition';
import {
  assertNoPauseResumeTransition,
  recordPauseResumeConfirmationFailure,
  reportedPauseResumeFailure,
} from './laser-pause-resume-failure';
import { beginPostJobSettle, type PostJobSettleRefs } from './laser-post-job-settle';
import { liftPausedCncJob } from './cnc-pause-lift';
import { currentCncPauseLift } from './cnc-pause-lift-state';
import { CNC_REENTRY_BUSY_MESSAGE, resumeLiftedCncJob } from './cnc-pause-reentry-run';
import {
  cncPauseResumeStalledNotice,
  streamStalledNotice,
  type LaserSafetyAction,
} from './laser-safety-notice';
import type { LaserState } from './laser-store';
import { mpgCommandBlockMessage, pushLog } from './laser-store-helpers';
import type { SerialConnection } from '../../platform/types';
import { armHostedRefill, releaseHostedRefill } from './laser-hosted-refill';
import { captureHostedRefillStream } from './laser-hosted-refill-owner';
import {
  assertStreamPauseResumeReady,
  queueStreamPauseBeamOff,
  restoreStreamPauseBeam,
  streamPausePlan,
  streamSidePauseMessage,
} from './laser-stream-pause-beam';
import type { TranscriptSource } from './laser-transcript';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

type PauseResumeContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: PostJobSettleRefs & { readonly connection?: SerialConnection | null };
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
  if (alreadyLifted(context)) return;
  // Pause is about to change the stream's status, so this side takes the
  // refill back first; a confirmed Resume can hand it over again (ADR-354).
  // Unlike Abort's reset, the door byte does not retire the worker's refill,
  // so the host must freeze at the line where the worker stopped. The
  // handshake runs before the transition owner starts, so it cannot eat the
  // confirmation deadline and turn a slow handover into a fail-dark reset.
  await releaseHostedRefill(context.refs);
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
    // Marlin: a beam-off queued behind the buffered motion (MA-1).
    const plan = streamPausePlan(context.get(), activeDriver);
    const message =
      plan === null ? PAUSE_UNSUPPORTED_MESSAGE : streamSidePauseMessage(plan.offLines);
    context.get().pushSystemNotice(`[lf2] ${message}`);
    await queueStreamPauseBeamOff(context, plan);
    return;
  }
  await runOwnedPauseResumeTransition(context, 'pause', timeoutMessage, async (token) => {
    freezeStreamer(context);
    if (safetyDoor !== null) {
      await sendRealtimeAndConfirmPauseResume(context, {
        token,
        command: pauseByte,
        expectedSession: controlSession,
        accept: (report) => isSettledWithSpindleOff(report, laserJob),
        timeoutMessage,
        action: 'pause',
        liveness: laserJob ? 'none' : 'cnc-door',
      });
      assertCurrentPauseConfirmation(context, laserJob);
      logCoolantKeptOn(context, laserJob);
    } else {
      await writeWhilePauseResumeOwner(context, {
        token,
        command: pauseByte,
        action: 'pause',
      });
    }
  });
  // ADR-410: with the hold settled, lift the bit out of the cut so Resume
  // never restarts the spindle in the wood.
  if (!laserJob) await liftPausedCncJob(context);
}

export async function runConfirmedResumeJob(context: PauseResumeContext): Promise<void> {
  assertResumeCommandOwnership(context);
  assertNoPauseResumeTransition(context);
  // A lifted job no longer lives in the controller: Resume re-enters it.
  if (currentCncPauseLift(context.get()) !== null) return resumeLiftedCncJob(context);
  // ADR-180 amendment 2 (2026-07-25): Resume is door-confirmed whenever the
  // driver has a door byte, for CNC as well as laser — Pause parked via Door, so
  // Resume must wait for the controller to report Run/Idle before the stream is
  // refilled. GRBL restores spindle and coolant on door-resume and holds motion
  // for SAFETY_DOOR_SPINDLE_DELAY (4.0s stock) so the cutter is back at speed
  // before the interrupted move continues.
  const activeDriver = context.driver();
  assertStreamPauseResumeReady(context, activeDriver);
  const laserJob = context.get().activeJobMachineKind !== 'cnc';
  const confirmedDoorResume = activeDriver.realtime.safetyDoor !== null;
  const controlSession = context.get().controllerSessionEpoch;
  const readOwnedStreamer = captureHostedRefillStream(context);
  const resumeByte = activeDriver.realtime.resume;
  const timeoutMessage = laserJob
    ? RESUME_CONFIRMATION_TIMEOUT_MESSAGE
    : CNC_RESUME_CONFIRMATION_TIMEOUT_MESSAGE;
  // A laser controller that keeps answering with a parked, beam-off Door state
  // refused cycle start (its door or lid input is open); that keeps the job.
  const doorHold =
    laserJob && confirmedDoorResume
      ? trackControllerDoorHold(() => context.get().accessoryCache)
      : null;
  let finishedWithoutRefill = false;

  const resumeWork = async (token: PauseResumeTransitionToken): Promise<void> => {
    assertResumeCommandOwnership(context);
    if (resumeByte !== null && confirmedDoorResume) {
      await sendRealtimeAndConfirmPauseResume(context, {
        token,
        command: resumeByte,
        expectedSession: controlSession,
        accept: (report) => report.state === 'Run' || report.state === 'Idle',
        timeoutMessage,
        action: 'resume',
        liveness: laserJob ? 'door-restore' : 'cnc-door',
        ...(doorHold === null ? {} : { observeFreshReport: doorHold.observe }),
      });
      assertCurrentResumeConfirmation(context);
    } else if (resumeByte !== null) {
      await writeWhilePauseResumeOwner(context, {
        token,
        command: resumeByte,
        action: 'resume',
      });
    } else {
      await restoreStreamPauseBeam(context, activeDriver, token);
    }
    assertResumeCommandOwnership(context);
    finishedWithoutRefill = await refillResumedStream(context, {
      token,
      liveness: !laserJob && confirmedDoorResume ? 'cnc-door' : 'none',
    });
    // The resumed window is accepted before the same ready barrier used by
    // Start takes a fresh ledger snapshot. Never lend a cancelled transition
    // or a replacement run/connection to the worker when ready arrives late.
    await armHostedRefill(context.refs, () =>
      ownsPauseResumeTransition(context.refs, token) ? readOwnedStreamer() : null,
    );
  };
  await runOwnedPauseResumeTransition(
    context,
    'resume',
    timeoutMessage,
    resumeWork,
    doorHold?.isHeld,
  );
  if (finishedWithoutRefill) {
    beginPostJobSettle(context.set, context.get, context.refs, context.safeWrite);
  }
}

function freezeStreamer(context: PauseResumeContext): void {
  context.set((state) => {
    if (state.streamer === null) return {};
    const pausedStreamer = pauseStreamer(state.streamer);
    if (pausedStreamer === state.streamer && state.streamer.status !== 'paused') return {};
    // Freezing the sender does not prove the controller has stopped. The live
    // clock and route keep following physical status through buffered motion
    // and deceleration; a fresh settled hold freezes them separately.
    return { streamer: pausedStreamer };
  });
}

async function runOwnedPauseResumeTransition(
  context: PauseResumeContext,
  action: PauseResumeTransitionAction,
  timeoutMessage: string,
  work: (token: PauseResumeTransitionToken) => Promise<void>,
  controllerHoldsJob?: () => boolean,
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
    // Only an expired deadline with every owned write settled can be the
    // controller's own refusal; silence, a lost write and anything else keep
    // the reset below.
    const heldByController =
      !failDarkAlreadyOwned &&
      isPauseResumeDeadlineError(error) &&
      !hasCurrentPauseResumeTransportFence(context.refs, owner.token) &&
      controllerHoldsJob?.() === true;
    completePauseResumeTransition(context.refs, owner.token);
    // A Resume can fail while its first post-confirmation stream write is still
    // pending. Keep its staged queue/in-flight accounting, but make the host
    // sender paused again before surfacing the failure so an early or late ack
    // cannot refill beyond the failed transition.
    freezeStreamer(context);
    const failure = recordPauseResumeConfirmationFailure(
      context,
      heldByController
        ? new Error(LASER_RESUME_DOOR_HELD_MESSAGE)
        : reportedPauseResumeFailure(context, error),
    );
    cancelFreshControllerStatusWait(context.refs, failure.message);
    // ADR-180 amendment 3 (2026-07-25): only a laser escalates to a fail-dark
    // reset. On a laser a stuck-on beam is the hazard, so resetting the
    // controller is the correct response (ADR-179). On a router the Door state
    // has already de-energized the spindle, and a soft reset would destroy a
    // recoverable job — turning a missed confirmation into a scrapped workpiece.
    // The notice still surfaces; the stream stays frozen; the operator decides.
    // A laser whose controller answers with a fresh, parked, beam-off Door is
    // not an unconfirmed beam: it gets the same keep-the-job treatment.
    if (heldByController) {
      context.set((state) => ({ safetyNotice: state.safetyNotice ?? controllerDoorHeldNotice() }));
    } else if (!failDarkAlreadyOwned) {
      recordPauseResumeStall(context);
    }
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

function assertCurrentPauseConfirmation(context: PauseResumeContext, requireProof: boolean): void {
  const state = context.get();
  if (isSettledPauseState(state.statusReport) && spindleIsOff(state.accessoryCache, requireProof)) {
    return;
  }
  throw new Error(PAUSE_CONFIRMATION_TIMEOUT_MESSAGE);
}

// grblHAL's keep-coolant door option leaves M8/M7 running while the spindle or
// laser is off. That is configured controller behaviour, not a failed pause,
// so it is recorded once rather than refused.
function logCoolantKeptOn(context: PauseResumeContext, laserJob: boolean): void {
  const state = context.get();
  if (!coolantIsOn(state.accessoryCache)) return;
  const output = laserJob ? 'The laser is off' : 'The spindle is off';
  context.set({
    log: pushLog(
      state,
      `[lf2] Paused with coolant or air assist still on: the controller keeps it running in its door state (grblHAL keep-coolant door option). ${output}.`,
    ),
  });
}

function assertCurrentResumeConfirmation(context: PauseResumeContext): void {
  assertResumeCommandOwnership(context);
  const state = context.get().statusReport?.state;
  if (state === 'Run' || state === 'Idle') return;
  throw new Error(RESUME_CONFIRMATION_TIMEOUT_MESSAGE);
}

function assertResumeCommandOwnership(context: PauseResumeContext): void {
  const state = context.get();
  const blocked = mpgCommandBlockMessage(state);
  if (blocked === null) return;
  context.set({
    lastWriteError: blocked,
    log: pushLog(state, `[lf2] Resume blocked: ${blocked}`),
  });
  throw new Error(blocked);
}

function clearPauseResumeTransitionState(
  context: PauseResumeContext,
  token: PauseResumeTransitionToken,
): void {
  if (hasCurrentPauseResumeTransportFence(context.refs, token)) return;
  context.set((state) =>
    state.pauseResumeTransition?.token === token.id ? { pauseResumeTransition: null } : {},
  );
}

// A lifted job is already paused; a lift or re-entry in motion answers only
// to Abort (ADR-410).
function alreadyLifted(context: PauseResumeContext): boolean {
  const lift = currentCncPauseLift(context.get());
  if (lift === null) return false;
  if (lift.phase === 'lifted') return true;
  context.set((state) => ({
    lastWriteError: CNC_REENTRY_BUSY_MESSAGE,
    log: pushLog(state, `[lf2] Pause blocked: ${CNC_REENTRY_BUSY_MESSAGE}`),
  }));
  throw new Error(CNC_REENTRY_BUSY_MESSAGE);
}

function assertPauseSafe(context: PauseResumeContext): void {
  if (context.get().controllerSettings?.laserModeEnabled === true) return;
  context.set({
    lastWriteError: PAUSE_REQUIRES_LASER_MODE_MESSAGE,
    log: pushLog(context.get(), `[lf2] Pause blocked: ${PAUSE_REQUIRES_LASER_MODE_MESSAGE}`),
  });
  throw new Error(PAUSE_REQUIRES_LASER_MODE_MESSAGE);
}
