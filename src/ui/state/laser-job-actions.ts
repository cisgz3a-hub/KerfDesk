// laser-job-actions — Start / Pause / Resume / Abort (laser-job-stop.ts),
// extracted from laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  continueToolChange as continueToolChangeStreamer,
  createStreamer,
  step,
} from '../../core/controllers/grbl';
import { isToolChangeLine } from '../../core/controllers/grbl/streamer';
import type { ControllerDriver } from '../../core/controllers';
import { extractToolChangeLabels } from '../../core/output';
import { cncControllerEpochOf, type CncControllerEpoch } from './cnc-setup-attestation';
import {
  assertCncLiveStartReady,
  assertCncMpgInactive,
  refreshCncLiveStartState,
} from './cnc-live-start-readiness';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import {
  assertActiveDriverAcceptsMachineKind,
  assertCncSetupAttested,
  assertGcodeFitsController,
  assertProgramHasSendableLine,
  assertStartControllerEvidence,
} from './laser-start-program-assertions';
import { startControllerCommand } from './laser-interactive-command';
import { frameProofReset } from './laser-session-reset';
import type { LaserSafetyAction } from './laser-safety-notice';
import {
  hasPendingControllerWrite,
  startPendingControllerMessage,
} from './laser-start-queue-fence';
import {
  assertAutofocusIdle,
  mpgCommandBlockMessage,
  pushLog,
  setupCommandBlockMessage,
  toolChangeContinueBlockMessage,
} from './laser-store-helpers';
import { steppedStreamerPatch } from './tool-change-hold-entry';
import type { LaserState, StartJobOptions } from './laser-store';
import { normalizeStartJobOptions } from './laser-job-options';
import { effectiveStartStreamOptions } from './laser-job-effective-stream-options';
import { validatedStartJobTimingPlan } from './laser-job-timing-handoff';
import { liveCanvasExecutionAcceptedPatch, liveCanvasStartPatch } from './live-canvas-run';
import { runConfirmedPauseJob, runConfirmedResumeJob } from './laser-job-pause-resume';
import { runStopJob, type JobStopContext } from './laser-job-stop';
import {
  containActiveStreamWriteFailure,
  streamWriteOwner,
} from './laser-stream-heartbeat-containment';
import { consumeClaimedFramedRun } from './framed-run-start-consumption';
import { refreshLaserLiveStartState } from './laser-live-start-readiness';
import { laserStartOverrideReset } from './laser-start-override-reset';
import { armHostedRefill, releaseHostedRefill } from './laser-hosted-refill';
import { captureHostedRefillStream } from './laser-hosted-refill-owner';
import { JobStartTransmissionError } from './laser-start-transmission-error';
import { createStartArmingCompletion } from './laser-start-arming-completion';
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
type DriverFn = () => ControllerDriver;
type StartSetupEpoch = CncControllerEpoch;
type JobActionContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: JobStopContext['refs'];
  readonly safeWrite: SafeWriteFn;
  readonly driver: DriverFn;
};

// GRBL acks in strict receive order: an ok still owed to a console/origin/
// handshake write, mis-attributed to a fresh job stream, frees RX budget the
// controller has not freed — the phantom refill can overflow the real buffer
// mid-burn. Start briefly waits for the owed acks; a controller that stays
// silent past this budget is a connection problem the operator must see.
const UNTRACKED_ACK_DRAIN_TIMEOUT_MS = 1_500;
const UNTRACKED_ACK_DRAIN_POLL_MS = 25;
export const TOOL_CHANGE_PLAN_MISMATCH_MESSAGE =
  'The compiled tool plan does not match the CNC program pauses. Start was blocked so tool identity cannot drift at a change boundary.';

export function jobActions(
  set: SetFn,
  get: GetFn,
  refs: JobActionContext['refs'],
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob' | 'continueToolChange'> {
  const context: JobActionContext = { set, get, refs, safeWrite, driver };
  // The fail-dark stop records no request: the safety notice it follows
  // already names the cause for recovery.
  const failDarkStop = (): Promise<void> => runStopJob(context);
  return {
    continueToolChange: () => runContinueToolChange(context),
    startJob: (gcode, options = {}) => runStartJob(context, gcode, options),
    pauseJob: () => runConfirmedPauseJob({ ...context, failDarkStop }),
    resumeJob: () => runConfirmedResumeJob({ ...context, failDarkStop }),
    stopJob: (reason) => runStopJob(context, reason === 'app-closing' ? 'app-closing' : 'operator'),
  };
}

async function runStartJob(
  context: JobActionContext,
  gcode: string,
  options: StartJobOptions,
): Promise<void> {
  const { set, get, safeWrite } = context;
  assertProgramHasSendableLine(gcode);
  assertStartAllowed(set, get);
  const setupEpoch: StartSetupEpoch = cncControllerEpochOf(get());
  const completion = createStartArmingCompletion(context);
  set({
    controllerOperation: { kind: 'start-arming', phase: 'queue-fence' },
    ...(options.framedRunPermit === undefined ? frameProofReset() : {}),
  });
  try {
    const effectiveOptions = await prepareStartBoundary(context, gcode, options, setupEpoch);
    // prepareStartBoundary intentionally awaits queue/controller evidence. App
    // and camera state are outside the controller reservation and can change
    // during those awaits, so the owner gets one last synchronous refusal
    // point before streamer/activeRun state or the first program write exists.
    options.assertFinalStartAuthorized?.();
    completion.assertCurrent();
    consumeClaimedFramedRun(set, get, options.framedRunPermit);
    const overrideReset = laserStartOverrideReset(options.machineKind ?? 'laser', get()); // ADR-355
    const { stepped, labels, toolIds } = prepareInitialStream(gcode, effectiveOptions);
    const entersHoldNow = stepped.state.status === 'tool-change';
    const writeOwner = { ...streamWriteOwner(get()), streamerEpoch: get().streamerEpoch + 1 };
    // Seed this run's tool queue first: a short first section can reach its M0
    // synchronously, and the shared hold entry then consumes the queue head.
    const toolQueue = {
      toolChangeLabels: labels,
      toolChangeToolIds: toolIds,
      pendingToolLabel: null,
      pendingToolId: null,
    };
    set((state) => ({
      ...toolQueue,
      ...steppedStreamerPatch({ ...state, ...toolQueue }, null, stepped.state),
      streamerEpoch: writeOwner.streamerEpoch,
      activeRunId: options.runId ?? null,
      ...liveCanvasStartPatch(
        options.canvasPlan,
        Date.now(),
        validatedStartJobTimingPlan(gcode, options, state),
        entersHoldNow && stepped.toSend.length === 0 ? 'tool-change' : 'running',
        stepped.state.queued,
        gcode,
      ),
      accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
      activeJobMachineKind: options.machineKind ?? 'laser',
    }));
    completion.streamStarted(writeOwner, options.runId ?? null);
    if (stepped.toSend.length === 0) return;
    try {
      await overrideReset.send(stepped.toSend, safeWrite, completion.ownsCurrent);
      if (!completion.ownsCurrent()) return;
      set((state) => overrideReset.accepted(state, liveCanvasExecutionAcceptedPatch(state)));
      // The first window is on the wire and accounted for, so the transport
      // may take the refill from here (ADR-334). A transport that cannot host
      // it, or a stream that is no longer simply streaming, is a no-op.
      await armHostedRefill(context.refs, () => (completion.ownsCurrent() ? get().streamer : null));
      completion.accept();
    } catch (error) {
      const state = get();
      const ackedLines =
        state.streamerEpoch === writeOwner.streamerEpoch ? (state.streamer?.completed ?? 0) : 0;
      containActiveStreamWriteFailure(set, context.refs, safeWrite, 'start', writeOwner);
      // A rejected write can already have delivered a prefix. Preserve the
      // attempt independently of live state, which teardown may already clear.
      throw new JobStartTransmissionError(error, options.runId ?? null, ackedLines);
    }
  } finally {
    completion.finish();
  }
}

async function prepareStartBoundary(
  context: JobActionContext,
  gcode: string,
  options: StartJobOptions,
  setupEpoch: StartSetupEpoch,
): Promise<StartJobOptions> {
  const { set, get, refs, safeWrite, driver } = context;
  if (hasPendingControllerWrite(get())) {
    await waitForUntrackedAckDrain(get);
    assertStartAllowed(set, get, true);
  }
  assertCncSetupAttested(gcode, options, setupEpoch);
  const machineKind = options.machineKind ?? 'laser';
  assertActiveDriverAcceptsMachineKind(machineKind, driver());
  assertCncMpgInactive(set, get, machineKind);
  if (machineKind === 'cnc') {
    await startControllerCommand(refs, safeWrite, {
      kind: 'start-arming',
      label: 'CNC Start queue fence',
      command: `${driver().commands.settleDwell}\n`,
      timeoutMs: UNTRACKED_ACK_DRAIN_TIMEOUT_MS,
      statusOwnership: 'cnc-start-settle-dwell',
    });
  }
  assertStartReservation(get, setupEpoch);
  await refreshCncLiveStartState(set, get, safeWrite, driver, machineKind);
  await refreshLaserLiveStartState({
    set,
    get,
    refs,
    safeWrite,
    driver,
    machineKind,
    permit: options.framedRunPermit,
  });
  assertStartAllowed(set, get, true);
  assertCncLiveStartReady(set, get, machineKind);
  assertStartReservation(get, setupEpoch);
  const pendingState = get();
  if (hasPendingControllerWrite(pendingState)) {
    throw new Error(startPendingControllerMessage(pendingState));
  }
  const effectiveOptions = effectiveStartStreamOptions(options, pendingState, driver().kind);
  assertStartControllerEvidence(machineKind, options, gcode);
  assertGcodeFitsController(gcode, effectiveOptions, driver().kind);
  return effectiveOptions;
}

function prepareInitialStream(
  gcode: string,
  options: StartJobOptions,
): {
  readonly stepped: ReturnType<typeof step>;
  readonly labels: ReadonlyArray<string>;
  readonly toolIds: ReadonlyArray<string | null>;
} {
  const streamOptions = normalizeStartJobOptions(options);
  const stepped = step(
    createStreamer(gcode, { ...streamOptions, toolChangePause: options.machineKind === 'cnc' }),
  );
  return { stepped, ...toolChangeManifest(gcode, options) };
}

function toolChangeManifest(
  gcode: string,
  options: StartJobOptions,
): {
  readonly labels: ReadonlyArray<string>;
  readonly toolIds: ReadonlyArray<string | null>;
} {
  if (options.machineKind !== 'cnc') return { labels: [], toolIds: [] };
  // Structured compile metadata carries stable IDs without changing G-code
  // bytes. Direct/imported callers retain the legacy comment-label fallback.
  const plannedChanges = options.cncToolPlan?.slice(1);
  if (plannedChanges !== undefined && plannedChanges.length !== countToolChangeBoundaries(gcode)) {
    throw new Error(TOOL_CHANGE_PLAN_MISMATCH_MESSAGE);
  }
  const labels =
    plannedChanges?.map((tool) => tool.name ?? tool.id ?? 'next tool') ??
    extractToolChangeLabels(gcode);
  return {
    labels,
    toolIds: plannedChanges?.map((tool) => tool.id) ?? labels.map(() => null),
  };
}

export function countToolChangeBoundaries(gcode: string): number {
  return gcode.split('\n').filter(isToolChangeLine).length;
}

function assertStartAllowed(set: SetFn, get: GetFn, allowStartArming = false): void {
  const state = get();
  assertAutofocusIdle(state);
  const gateState =
    allowStartArming && state.controllerOperation?.kind === 'start-arming'
      ? { ...state, controllerOperation: null }
      : state;
  const blockedMessage = setupCommandBlockMessage(gateState);
  if (blockedMessage !== null) {
    set({
      lastWriteError: blockedMessage,
      log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
    });
    throw new Error(blockedMessage);
  }
}

function assertStartReservation(get: GetFn, expected: StartSetupEpoch): void {
  const state = get();
  const unchanged =
    state.controllerOperation?.kind === 'start-arming' &&
    (state.trustedPositionEpoch ?? 0) === expected.trustedPosition &&
    state.workZReferenceEpoch === expected.workZReference;
  if (unchanged) return;
  throw new Error(
    'CNC Start lost its exclusive controller/setup reservation before streaming. Re-check setup and try again.',
  );
}

async function waitForUntrackedAckDrain(get: GetFn): Promise<void> {
  const deadline = Date.now() + UNTRACKED_ACK_DRAIN_TIMEOUT_MS;
  while (hasPendingControllerWrite(get())) {
    if (Date.now() > deadline) throw new Error(startPendingControllerMessage(get()));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, UNTRACKED_ACK_DRAIN_POLL_MS);
    });
  }
}

// Leave a tool-change hold: drop the swallowed M0 and pump the stream from the
// emitter's spindle-off safe-Z lift, followed by M3/G4. Unlike resume there is NO realtime resume byte — the
// controller was never held (the M0 was never sent); it is idling at the park
// position and simply needs the next lines fed. Functional set for the same
// at-write-time snapshot reason as runResumeJob.
async function runContinueToolChange(context: JobActionContext): Promise<void> {
  const { set, get, refs, safeWrite } = context;
  const heldStream = get().streamer;
  if (heldStream?.status !== 'tool-change') return;
  const writeOwner = streamWriteOwner(get());
  const readOwnedStreamer = captureHostedRefillStream(context);
  // The hold's ACK path may still be releasing the old hosted refill. Finish
  // that handback before consuming M0, and do not consume a replacement hold
  // or the same hold twice if another Continue won this await.
  await releaseHostedRefill(refs);
  if (readOwnedStreamer() !== heldStream) return;
  // Fresh Idle proves the pre-M0 retract/park completed; fresh work-Z evidence
  // proves the replacement bit was touched off. Both are required before the
  // stream may issue its spindle-off safe-Z lift and later M3/G4.
  const blockMessage = toolChangeContinueBlockMessage(get());
  if (blockMessage !== null) {
    set({ lastWriteError: blockMessage });
    return;
  }
  let toSend = '';
  set((s) => {
    if (s.streamer === null) return s;
    const continued = continueToolChangeStreamer(s.streamer);
    const stepped = step(continued);
    toSend = stepped.toSend;
    // Continuing always consumes the current M0, so a resulting 'tool-change'
    // status is a NEW hold reached within this single fill. The ack path never
    // sees it (status was already 'tool-change'), so the shared entry patch
    // applies here (F22).
    return steppedStreamerPatch(s, continued, stepped.state);
  });
  if (toSend.length > 0) {
    try {
      await safeWrite(toSend, 'resume');
      if (readOwnedStreamer() === null) return;
      const mpgBlock = mpgCommandBlockMessage(get());
      if (mpgBlock !== null) {
        set({ lastWriteError: mpgBlock });
        return;
      }
      set((state) => liveCanvasExecutionAcceptedPatch(state));
      await armHostedRefill(refs, readOwnedStreamer);
    } catch (err) {
      containActiveStreamWriteFailure(set, refs, safeWrite, 'resume', writeOwner);
      throw err;
    }
  }
}
