// laser-job-stop — Abort. ABORT JOB, ABORT MOTION (jog, Frame, a controller
// operation) and the fail-dark stops all run this. Split from
// laser-job-actions when the Marlin quickstop pushed that module past the
// 400-line cap.
//
// A GRBL-family or Smoothieware controller gets its realtime soft reset and
// the beam-off cleanup after the reboot banner, or after a short fallback
// delay. Smoothieware halts instead of rebooting and prints no banner, so its
// qualification is re-armed here (controller audit CG-3). A controller without
// a realtime reset gets the driver's ordered stop lines (Marlin: M107, M410,
// M5 I, then M9 when air may be on; laser-quick-stop.ts) as ordinary lines
// that owe acknowledgements (controller audit MA-7, CG-10). Only a stop that
// sent a reset byte forgets the work origin (MA-3): Marlin keeps its G92
// position_shift through M410 (G92.cpp L95-L98).

import { cancel as cancelStreamer, markErrored } from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import type { SerialConnection } from '../../platform/types';
import type { OwnedResetSettingsRefs } from './laser-owned-reset-settings';
import { clearCncLiveCaps } from './detected-settings-action';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import { reportedWorkOffsetMm } from './infer-machine-position';
import {
  heldAtDrainedToolChange,
  plainJobStopRequest,
  streamResetRecord,
  type JobStopReason,
  type JobStopRequest,
  type RotaryStartTurn,
} from './job-stop-request';
import { rotaryOutputAxis } from '../../core/job/rotary-job';
import { reportedTurnScale } from '../../core/controllers/grbl/reported-turn-units';
import { useStore } from './store';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { recordControllerRecoveryReset } from './laser-controller-operation';
import {
  requalifyAfterHaltingReset,
  type ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';
import { hostedRefillArmed, releaseHostedRefill } from './laser-hosted-refill';
import {
  cancelControllerLifecycleRefs,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { interactiveControllerOperation } from './laser-controller-operation';
import {
  cancelPauseResumeTransition,
  hasPauseResumeTransition,
} from './laser-pause-resume-transition';
import { driverQuickStops, isAirOffLine, noResetStopLines } from './laser-quick-stop';
import { armResetCleanup, resetCleanupLines, type ResetCleanupRefs } from './laser-reset-cleanup';
import {
  disconnectStopUnconfirmedNotice,
  isControllerHaltedNotice,
  quickStopUnconfirmedNotice,
  writeFailedNotice,
  type LaserSafetyAction,
} from './laser-safety-notice';
import { isActiveJob } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import { frameProofReset } from './laser-session-reset';
import { cancelPendingManualMotions } from './manual-motion-intent';
import { stopUnownedControllerMotion } from './unowned-motion-stop';
import { unownedControllerMotion } from './unowned-controller-motion';
import { captureStopOutcomeOwner, applyStopOutcome } from './laser-job-stop-outcome';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;

export type JobStopContext = {
  readonly set: SetFn;
  readonly get: () => LaserState;
  readonly refs: ResetCleanupRefs &
    ControllerLifecycleRefs &
    ControllerQualificationScheduleRefs &
    OwnedResetSettingsRefs & {
      readonly driver: ControllerDriver;
      readonly connection?: SerialConnection | null;
      readonly settingsCollector?: { readonly kind: string };
      onLineArrived?: (() => void) | null;
    };
  readonly safeWrite: (line: string, action?: LaserSafetyAction) => Promise<void>;
  readonly driver: () => ControllerDriver;
};

export type StopOutcome = {
  /** A line that switches air assist off reached the transport. */
  readonly airOffSent: boolean;
  /** The driver's quickstop (Marlin M410): 'sent' once every stop line reached
   * the transport, 'unsent' when a write failed part-way. */
  readonly quickStop: 'none' | 'sent' | 'unsent';
};

const TRANSITION_CANCELLATION_MESSAGE =
  'Pause or Resume was cancelled because the operator requested Abort.';

export async function runStopJob(context: JobStopContext, reason?: JobStopReason): Promise<void> {
  const connection = context.refs.connection;
  const connectionAttempt = context.get().connectionAttempt;
  const session = context.get().controllerSessionEpoch;
  const ownsAttempt = (): boolean => context.get().connectionAttempt === connectionAttempt;
  const ownsConnection = (): boolean => context.refs.connection === connection && ownsAttempt();
  const ownsSession = (): boolean =>
    ownsConnection() && context.get().controllerSessionEpoch === session;
  context = bindStopConnection(context, ownsConnection, ownsAttempt);
  try {
    const { set, refs, driver } = context;
    cancelPendingManualMotions(refs);
    set((state) => ({ manualMotionCancelEpoch: state.manualMotionCancelEpoch + 1 }));
    // Motion nothing here owns (a Console G1, `$J=` or `$H`) first gets the stop
    // that keeps position; a cancelled jog needs no reset (ADR-375 C-2). A page
    // that is closing cannot wait for a hold to settle, so it resets at once.
    if (reason !== 'app-closing' && unownedControllerMotion(context.get()) !== null) {
      const motionStop = await stopUnownedControllerMotion(context);
      if (!ownsSession() || motionStop === 'superseded') return;
      if (motionStop !== 'reset') {
        finishUnownedJogStop(context, motionStop);
        return;
      }
    }
    const softReset = driver().realtime.softReset;
    if (softReset === null) {
      await runNoResetStopUnlessDisconnecting(context, reason, ownsSession);
      return;
    }
    if (!ownsSession()) return;
    // Read before the cancel below clears it: a hold or restart still settling
    // means the last status report may not show the machine moving.
    const pauseResumeSettling = hasPauseResumeTransition(refs);
    cancelPauseResumeTransition(refs, TRANSITION_CANCELLATION_MESSAGE);
    const pendingOutcome = stopWithReset(context, softReset, reason, pauseResumeSettling);
    const stoppedWork = captureStopOutcomeOwner(context);
    const outcome = await pendingOutcome;
    if (ownsConnection()) applyStopOutcome(context, outcome, softReset, stoppedWork);
  } catch (error) {
    // Another connect/disconnect owns any current UI. A cable loss without a
    // new attempt still belongs to this Abort and must report its failure.
    if (ownsAttempt()) {
      reportClosedStopWriteFailure(context);
      throw error;
    }
  }
}

// Disconnect has frozen the stream and is writing these same stop lines before
// it closes the port. It owns the controller until the close; taking its
// operation over would reopen polling and command gates meanwhile.
async function runNoResetStopUnlessDisconnecting(
  context: JobStopContext,
  reason: JobStopReason | undefined,
  ownsSession: () => boolean,
): Promise<void> {
  if (context.get().controllerOperation?.kind === 'disconnect') return;
  await runNoResetStop(context, reason, ownsSession);
}

type StopLineWrites = { readonly airOffSent: boolean; readonly allSent: boolean };

// A worker-held refill (Marlin, ADR-676) comes back before the freeze, as on
// Pause, so the worker cannot send a line this side's frozen ledger does not
// hold. The stop lines do not wait for that handshake: its reply queues behind
// every line the worker forwarded while this thread was busy, and meanwhile
// the controller can drain and stop with the beam lit (rolling audit v8
// N1-P2-1). The release is posted first, so the worker stops refilling before
// the stop lines reach it; then every stop line, and only the freeze waits.
// With no worker refill, nothing here yields before the freeze.
async function runNoResetStop(
  context: JobStopContext,
  reason: JobStopReason | undefined,
  ownsSession: () => boolean,
): Promise<void> {
  // Cancellation clears the unsent program, including any M7/M8 that requires
  // M9 cleanup. Capture that requirement before retiring the queue.
  const lines = noResetStopLines(context.driver(), context.get());
  if (!hostedRefillArmed(context.refs)) {
    await freezeAndStopWithoutReset(context, reason, ownsSession, lines);
    return;
  }
  const released = releaseHostedRefill(context.refs);
  const sent = writeStopLinesAtOnce(context, lines);
  await released;
  if (!ownsSession()) return;
  await freezeAndStopWithoutReset(context, reason, ownsSession, lines, sent);
}

// A no-reset Abort must retire host refill before even the handback await.
// Retain its sent-line ledger: their real replies still precede the stop-line
// replies. The temporary owner keeps a fresh Idle from reopening Start while
// cleanup is being written; cancellation is not proof of a physical stop.
async function freezeAndStopWithoutReset(
  context: JobStopContext,
  reason: JobStopReason | undefined,
  ownsSession: () => boolean,
  lines: ReadonlyArray<string>,
  sent?: Promise<StopLineWrites>,
): Promise<void> {
  const { set, get, refs, driver } = context;
  const initial = get();
  const operation = isActiveJob(initial.streamer)
    ? interactiveControllerOperation('Aborting job', 'terminal-exchange')
    : null;
  if (operation !== null && initial.streamer !== null) {
    cancelControllerLifecycleRefs(refs, TRANSITION_CANCELLATION_MESSAGE);
    set({
      streamer: cancelStreamer(initial.streamer),
      controllerOperation: operation,
      ...frameProofReset(),
      ...(reason === undefined ? {} : { jobStopRequest: plainJobStopRequest(reason, initial) }),
      ...(isControllerHaltedNotice(initial.safetyNotice)
        ? {}
        : {
            safetyNotice: driverQuickStops(driver())
              ? quickStopUnconfirmedNotice()
              : disconnectStopUnconfirmedNotice(),
          }),
    });
  }
  const ownsStop = (): boolean =>
    ownsSession() &&
    (operation === null ||
      (get().controllerOperation === operation && get().streamerEpoch === initial.streamerEpoch));
  try {
    // Queued stop lines keep one writer through a hosted-refill handback.
    await releaseHostedRefill(refs);
    if (!ownsStop()) return;
    cancelPauseResumeTransition(refs, TRANSITION_CANCELLATION_MESSAGE);
    const stoppedWork = captureStopOutcomeOwner(context);
    const outcome = await stopWithoutReset(context, lines, ownsStop, sent);
    if (ownsStop()) applyStopOutcome(context, outcome, null, stoppedWork);
  } finally {
    if (operation !== null && get().controllerOperation === operation) {
      set({ controllerOperation: null });
    }
  }
}

/** Keep every delayed stop write, including banner cleanup, on its original
 * transport. The stop's own reset changes the session epoch, so that epoch
 * fences only preparation above, not its expected post-reset cleanup. */
function reportClosedStopWriteFailure(context: JobStopContext): void {
  if (context.refs.connection != null) return;
  context.set((state) => {
    const notice = state.safetyNotice;
    // Preserve the original factual incident; a generic cable-loss fallback
    // must still report this same operator Stop's rejected transport.
    return notice === null || notice.kind === 'disconnect-during-job'
      ? { safetyNotice: writeFailedNotice('stop') }
      : {};
  });
}

function bindStopConnection(
  context: JobStopContext,
  ownsConnection: () => boolean,
  ownsAttempt: () => boolean,
): JobStopContext {
  const driver = context.driver();
  return {
    ...context,
    driver: () => driver,
    set: (partial) => {
      if (ownsAttempt()) context.set(partial);
    },
    safeWrite: async (line, action) => {
      if (!ownsConnection()) throw new Error('Abort belongs to a replaced controller connection.');
      await context.safeWrite(line, action);
    },
  };
}

function finishUnownedJogStop(context: JobStopContext, result: 'stopped' | 'unconfirmed'): void {
  if (result === 'stopped') {
    context.set({ airAssistOn: false, accessoryCache: null });
    return;
  }
  context.set((state) => ({
    safetyNotice: state.safetyNotice ?? {
      kind: 'disconnect-stop-unconfirmed',
      message:
        'Abort requested jog cancellation, but could not confirm Idle and send all ' +
        'spindle/laser and air-off commands. Accessories may still be on. Use the physical ' +
        'E-stop or power cutoff if unsafe, and check the machine before continuing.',
    },
  }));
}

async function stopWithReset(
  context: JobStopContext,
  softReset: string,
  reason: JobStopReason | undefined,
  pauseResumeSettling: boolean,
): Promise<StopOutcome> {
  const { set, refs, safeWrite, driver } = context;
  if (isGrblFamilyDriver(driver())) return stopWithOwnedReset(context, reason, pauseResumeSettling);
  clearCncLiveCaps();
  const resetWriteEpoch = refs.writeEpoch ?? 0;
  const cleanupLines = resetCleanupLines(driver());
  // Freeze host refill before the first wire await. If the transport write
  // fails, the controller may still be executing its old buffer; keeping an
  // errored (active) streamer leaves Abort visible without sending more job
  // bytes. Arm cleanup first so an immediate boot banner cannot outrun it.
  set((state) => {
    const evidence = invalidateControllerSessionEvidence(state);
    const invalidated = { ...state, ...evidence };
    recordControllerRecoveryReset(state.controllerOperation, {
      sessionEpoch: invalidated.controllerSessionEpoch,
      writeEpoch: resetWriteEpoch,
      statusSequence: state.statusSequence,
    });
    return {
      ...evidence,
      streamer: state.streamer === null ? null : markErrored(state.streamer),
      // Recovery reads this beside the errored stream so the saved cause is
      // the requested stop, not an unexplained end (ADR-341 Amendment 3).
      ...(reason === undefined || state.streamer === null
        ? {}
        : { jobStopRequest: plainJobStopRequest(reason, state) }),
      // And whether the reset may kill the steppers mid-motion (ADR-215
      // Amendment 1): decided now, because ALARM:3 arrives after the stream
      // is recorded as stopped.
      ...(state.streamer === null
        ? {}
        : { streamReset: streamResetRecord(state, pauseResumeSettling) }),
    };
  });
  requalifyAfterHaltingReset(set, context.get, refs, driver().capabilities);
  armResetCleanup(refs, safeWrite, cleanupLines);
  // The reset goes to the transport before the hosted refill is taken back.
  // A worker that receives it retires its own refill queue (ADR-334 §4), so
  // awaiting the release first only put the Abort byte behind every line
  // the renderer had yet to process, and behind a handshake timer that
  // closes the port. The release still runs, after the reset is posted, so
  // a silent worker is bounded exactly as before.
  const resetWrite = safeWrite(softReset, 'stop');
  void resetWrite.catch(() => undefined);
  await releaseHostedRefill(refs);
  await settleResetWrite(context, resetWrite, resetWriteEpoch);
  // The reset itself de-energizes coolant; the cleanup lines follow the banner.
  return { airOffSent: true, quickStop: 'none' };
}

async function stopWithOwnedReset(
  context: JobStopContext,
  reason: JobStopReason | undefined,
  pauseResumeSettling: boolean,
): Promise<StopOutcome> {
  const { set, refs, safeWrite, driver } = context;
  set((state) => ({
    // The reset below clears the work offset this session knows, so the G92
    // origin is read now, for the Alarm 3 card (ADR-341 Amendment 11).
    ...(reason === undefined || state.streamer === null
      ? {}
      : {
          jobStopRequest: {
            reason,
            streamerEpoch: state.streamerEpoch,
            ...g92OriginAtStop(state),
            ...heldAtDrainedToolChange(state),
            // Read here too: the stop outcome clears the job's own kind.
            ...(state.activeJobMachineKind === null
              ? {}
              : { jobMachineKind: state.activeJobMachineKind }),
          },
        }),
    ...(state.streamer === null
      ? {}
      : { streamReset: streamResetRecord(state, pauseResumeSettling) }),
  }));
  // Posting reset precedes taking back the hosted worker's refill queue.
  const resetWrite = runGrblDisconnectTransaction(set, refs, safeWrite, {
    retainConnection: true,
    awaitResetWriteOnly: true,
    action: 'stop',
    cleanupLines: resetCleanupLines(driver()),
  });
  void resetWrite.catch(() => undefined);
  await releaseHostedRefill(refs);
  await resetWrite;
  return { airOffSent: true, quickStop: 'none' };
}

function g92OriginAtStop(
  state: LaserState,
): Pick<JobStopRequest, 'originAtStopMm' | 'originMachineZeroEpoch' | 'rotaryStartTurn'> {
  const turn = rotaryStartTurnAtStop(state);
  const rotary = turn === null ? {} : { rotaryStartTurn: turn };
  if (!state.workOriginActive || state.workOriginSource !== 'g92') return rotary;
  const offset = reportedWorkOffsetMm(
    state.wcoCache,
    state.controllerSettings?.reportInches === true,
  );
  if (offset === null) return rotary;
  return {
    ...rotary,
    originAtStopMm: { x: offset.x, y: offset.y },
    originMachineZeroEpoch: state.machineZeroEpoch ?? 0,
  };
}

// A quickstop that may have reached the controller leaves homing and position
// unverified even when a later write failed; the log only reports one that
// was sent in full.
// Web Serial can deliver the commanded boot banner before write() settles.
// That observed reset boundary is stronger evidence than the stale transport
// promise; only rethrow when no reboot was observed. A port that closed under
// the write proves nothing was delivered.
async function settleResetWrite(
  context: JobStopContext,
  resetWrite: Promise<void>,
  resetWriteEpoch: number,
): Promise<void> {
  try {
    await resetWrite;
  } catch (error) {
    const portClosed = context.refs.connection == null;
    if (!portClosed && (context.refs.writeEpoch ?? 0) > resetWriteEpoch) return;
    if (portClosed) context.set({ safetyNotice: writeFailedNotice('stop') });
    throw error;
  }
}

// No realtime reset (Marlin): cancelling the host streamer is not proof that
// the machine stopped, so the notice is raised before the first await; a
// transport failure may replace it with the stronger write-failed notice.
// `sent`: the lines already went out with a worker handback.
async function stopWithoutReset(
  context: JobStopContext,
  lines: ReadonlyArray<string>,
  ownsStop: () => boolean,
  sent?: Promise<StopLineWrites>,
): Promise<StopOutcome> {
  const { set, get, driver } = context;
  const activeDriver = driver();
  const quickStopped = driverQuickStops(activeDriver);
  // A halted controller runs none of the stop lines; its reset advice stays.
  if (isActiveJob(get().streamer) && !isControllerHaltedNotice(get().safetyNotice)) {
    set({
      safetyNotice: quickStopped ? quickStopUnconfirmedNotice() : disconnectStopUnconfirmedNotice(),
    });
  }
  const writes = await (sent ?? writeStopLinesInOrder(context, lines, ownsStop));
  const allSent = writes.allSent && ownsStop();
  return {
    airOffSent: writes.airOffSent,
    quickStop: !quickStopped ? 'none' : allSent ? 'sent' : 'unsent',
  };
}

async function writeStopLinesInOrder(
  context: JobStopContext,
  lines: ReadonlyArray<string>,
  ownsStop: () => boolean,
): Promise<StopLineWrites> {
  let airOffSent = false;
  try {
    for (const line of lines) {
      if (!ownsStop()) return { airOffSent, allSent: false };
      await context.safeWrite(line, 'stop');
      if (isAirOffLine(line)) airOffSent = true;
    }
    return { airOffSent, allSent: true };
  } catch {
    // Best effort if the transport is already gone.
    return { airOffSent, allSent: false };
  }
}

// Every line is posted before the first await, in order.
async function writeStopLinesAtOnce(
  context: JobStopContext,
  lines: ReadonlyArray<string>,
): Promise<StopLineWrites> {
  const results = await Promise.allSettled(lines.map((line) => context.safeWrite(line, 'stop')));
  const sent = (index: number): boolean => results[index]?.status === 'fulfilled';
  return {
    airOffSent: lines.some((line, index) => sent(index) && isAirOffLine(line)),
    allSent: lines.every((_line, index) => sent(index)),
  };
}

// ADR-695 Amendment 1: the turn a dedicated-axis rotary job started from is
// its axis's work offset, because the job opened with G92 A0 (or Z0).
function rotaryStartTurnAtStop(state: LaserState): RotaryStartTurn | null {
  const { device, machine } = useStore.getState().project;
  const axis = rotaryOutputAxis(device, machine);
  const wco = state.wcoCache;
  if (axis === null || wco === null) return null;
  const reported = axis === 'A' ? wco.a : wco.z;
  // O12-P1-1: under `$13=1` grblHAL reports A in inches unless `$376` marks it.
  const value =
    reported === undefined
      ? undefined
      : reported * reportedTurnScale(state.controllerSettings, axis);
  return value === undefined || !Number.isFinite(value)
    ? null
    : { axis, machine: value, machineZeroEpoch: state.machineZeroEpoch ?? 0 };
}
