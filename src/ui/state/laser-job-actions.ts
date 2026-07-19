// laser-job-actions — Start / Pause / Resume / Abort, extracted from
// laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  cancel as cancelStreamer,
  continueToolChange as continueToolChangeStreamer,
  createStreamer,
  findOversizedLine,
  isSendableGcodeLine,
  markErrored,
  step,
  wipeInFlight,
} from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { extractToolChangeLabels } from '../../core/output';
import {
  CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE,
  cncControllerEpochOf,
  cncSetupAttestationMatches,
  type CncControllerEpoch,
} from './cnc-setup-attestation';
import {
  assertCncLiveStartReady,
  assertCncMpgInactive,
  refreshCncLiveStartState,
} from './cnc-live-start-readiness';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import {
  laserModeStartEvidenceIssue,
  type LaserModeStartSnapshotSource,
} from './laser-mode-start-evidence';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import { cancelPauseResumeTransition } from './laser-pause-resume-transition';
import { armResetCleanup, type ResetCleanupRefs } from './laser-reset-cleanup';
import { disconnectStopUnconfirmedNotice, type LaserSafetyAction } from './laser-safety-notice';
import {
  hasPendingControllerWrite,
  startPendingControllerMessage,
} from './laser-start-queue-fence';
import {
  assertAutofocusIdle,
  isActiveJob,
  pushLog,
  setupCommandBlockMessage,
  toolChangeContinueBlockMessage,
  toolChangeHoldEntryPatch,
} from './laser-store-helpers';
import type { LaserState, StartJobOptions } from './laser-store';
import { normalizeStartJobOptions } from './laser-job-options';
import { liveCanvasLifecyclePatch, liveCanvasStartPatch } from './live-canvas-run';
import { runConfirmedPauseJob, runConfirmedResumeJob } from './laser-job-pause-resume';
import { containActiveStreamWriteFailure } from './laser-stream-heartbeat-containment';
import { consumeClaimedFramedRun } from './framed-run-start-consumption';
import { originUnknownAfterControllerReset } from './laser-status-line';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type DriverFn = () => ControllerDriver;
type StartSetupEpoch = CncControllerEpoch;
type JobActionContext = {
  readonly set: SetFn;
  readonly get: GetFn;
  readonly refs: ResetCleanupRefs & ControllerLifecycleRefs;
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
const EMPTY_PROGRAM_MESSAGE = 'The job contains no sendable G-code commands.';

export function jobActions(
  set: SetFn,
  get: GetFn,
  refs: ResetCleanupRefs & ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob' | 'continueToolChange'> {
  const context: JobActionContext = { set, get, refs, safeWrite, driver };
  const stopJob = (): Promise<void> => runStopJob(context);
  return {
    continueToolChange: () => runContinueToolChange(set, get, refs, safeWrite),
    startJob: (gcode, options = {}) => runStartJob(context, gcode, options),
    pauseJob: () =>
      runConfirmedPauseJob({
        ...context,
        failDarkStop: stopJob,
      }),
    resumeJob: () =>
      runConfirmedResumeJob({
        ...context,
        failDarkStop: stopJob,
      }),
    stopJob,
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
  const setupEpoch = captureStartSetupEpoch(get());
  set({
    controllerOperation: { kind: 'start-arming', phase: 'queue-fence' },
    ...(options.framedRunPermit === undefined ? { frameVerification: null, framedRun: null } : {}),
  });
  try {
    await prepareStartBoundary(context, gcode, options, setupEpoch);
    // prepareStartBoundary intentionally awaits queue/controller evidence. App
    // and camera state are outside the controller reservation and can change
    // during those awaits, so the owner gets one last synchronous refusal
    // point before streamer/activeRun state or the first program write exists.
    options.assertFinalStartAuthorized?.();
    consumeClaimedFramedRun(set, get, options.framedRunPermit);
    const { stepped, labels, toolIds } = prepareInitialStream(gcode, options);
    const entersHoldNow = stepped.state.status === 'tool-change';
    set((state) => ({
      streamer: stepped.state,
      activeRunId: options.runId ?? null,
      ...liveCanvasStartPatch(options.canvasPlan),
      accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
      activeJobMachineKind: options.machineKind ?? 'laser',
      toolChangeLabels: entersHoldNow ? labels.slice(1) : labels,
      toolChangeToolIds: entersHoldNow ? toolIds.slice(1) : toolIds,
      pendingToolLabel: entersHoldNow ? (labels[0] ?? null) : null,
      pendingToolId: entersHoldNow ? (toolIds[0] ?? null) : null,
      ...toolChangeEntryPatch(state, entersHoldNow),
    }));
    if (stepped.toSend.length === 0) return;
    try {
      await safeWrite(stepped.toSend, 'start');
    } catch (error) {
      containActiveStreamWriteFailure(set, context.refs, safeWrite, 'start');
      // The first transport write did not resolve as accepted, so the staged
      // run must not replace an older recovery capsule. Keep the fail-dark
      // errored streamer and safety notice, but release only this run's
      // persistence ownership so the outer flow can discard its staging row.
      set((state) => ({
        activeRunId: state.activeRunId === options.runId ? null : state.activeRunId,
      }));
      throw error;
    }
  } finally {
    set((state) => ({
      controllerOperation:
        state.controllerOperation?.kind === 'start-arming' ? null : state.controllerOperation,
    }));
  }
}

function assertProgramHasSendableLine(gcode: string): void {
  if (gcode.split('\n').some(isSendableGcodeLine)) return;
  throw new Error(EMPTY_PROGRAM_MESSAGE);
}

async function prepareStartBoundary(
  context: JobActionContext,
  gcode: string,
  options: StartJobOptions,
  setupEpoch: StartSetupEpoch,
): Promise<void> {
  const { set, get, refs, safeWrite, driver } = context;
  if (hasPendingControllerWrite(get())) {
    await waitForUntrackedAckDrain(get);
    assertStartAllowed(set, get, true);
  }
  assertCncSetupAttested(gcode, options, setupEpoch);
  const machineKind = options.machineKind ?? 'laser';
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
  assertStartAllowed(set, get, true);
  assertCncLiveStartReady(set, get, machineKind);
  assertStartReservation(get, setupEpoch);
  const pendingState = get();
  if (hasPendingControllerWrite(pendingState)) {
    throw new Error(startPendingControllerMessage(pendingState));
  }
  assertLaserModeStartEvidence(get(), driver(), machineKind, options);
  assertGcodeFitsController(gcode, options);
}

async function runStopJob(context: JobActionContext): Promise<void> {
  const { set, get, refs, safeWrite, driver } = context;
  const transitionCancellationMessage =
    'Pause or Resume was cancelled because the operator requested Abort.';
  cancelPauseResumeTransition(refs, transitionCancellationMessage);
  const softReset = driver().realtime.softReset;
  if (softReset !== null) {
    const resetWriteEpoch = refs.writeEpoch ?? 0;
    const cleanupLines = resetCleanupLines(driver());
    // Freeze host refill before the first wire await. If the transport write
    // fails, the controller may still be executing its old buffer; keeping an
    // errored (active) streamer leaves Abort visible without sending more job
    // bytes. Arm cleanup first so an immediate boot banner cannot outrun it.
    set((state) => ({
      ...invalidateControllerSessionEvidence(state),
      streamer: state.streamer === null ? null : markErrored(state.streamer),
    }));
    armResetCleanup(refs, safeWrite, cleanupLines);
    try {
      await safeWrite(softReset, 'stop');
    } catch (error) {
      // Web Serial can deliver the commanded boot banner before write()
      // settles. That observed reset boundary is stronger evidence than the
      // stale transport promise; only rethrow when no reboot was observed.
      if ((refs.writeEpoch ?? 0) <= resetWriteEpoch) throw error;
    }
  }
  if (softReset === null) {
    // Marlin-style controllers have no realtime planner reset. M5/M107 are
    // queued behind motion already accepted by firmware, so cancelling the
    // host streamer is not proof that the physical machine stopped. Preserve
    // an explicit operator warning before the first await; a transport failure
    // may replace it with the stronger write-failed notice.
    if (isActiveJob(get().streamer)) {
      set({ safetyNotice: disconnectStopUnconfirmedNotice() });
    }
    try {
      for (const line of driver().commands.stopLaserLines) await safeWrite(`${line}\n`, 'stop');
    } catch {
      // Best effort if the transport is already gone.
    }
  }
  set((state) => ({
    wcoCache: null,
    accessoryCache: null,
    airAssistOn: false,
    // ADR-228 amendment: Abort during a frame must kill the proof directly —
    // an aborted trace was not completed, whatever the side effects imply.
    frameVerification: null,
    framedRun: null,
    ...originUnknownAfterControllerReset(state),
    streamer:
      state.streamer === null
        ? state.streamer
        : softReset !== null
          ? wipeInFlight(cancelStreamer(state.streamer))
          : cancelStreamer(state.streamer),
    ...liveCanvasLifecyclePatch(state, 'stopped'),
  }));
}

function resetCleanupLines(driver: ControllerDriver): ReadonlyArray<string> {
  const lines = driver.commands.stopLaserLines;
  return lines.some((line) => line.trim().toUpperCase() === 'M5') ? lines : ['M5', ...lines];
}

function assertLaserModeStartEvidence(
  state: LaserState,
  activeDriver: ControllerDriver,
  machineKind: 'laser' | 'cnc',
  options: StartJobOptions,
): void {
  if (machineKind !== 'laser') return;
  const source: LaserModeStartSnapshotSource = {
    controllerSessionEpoch: state.controllerSessionEpoch,
    capabilities: activeDriver.capabilities,
    controllerSettings: state.controllerSettings,
    controllerSettingsObservation: state.controllerSettingsObservation,
  };
  const issue = laserModeStartEvidenceIssue(source, options.laserModeStartEvidence);
  if (issue !== null) throw new Error(issue);
}

function assertGcodeFitsController(gcode: string, options: StartJobOptions): void {
  const streamOptions = normalizeStartJobOptions(options);
  const oversized = findOversizedLine(gcode, streamOptions.rxBufferBytes);
  if (oversized === null) return;
  throw new Error(
    `G-code line ${oversized.lineNumber} is ${oversized.bytes} bytes — longer than the ` +
      `controller's ${oversized.limit}-byte RX buffer; it can never be sent. Job not started.`,
  );
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

function assertCncSetupAttested(
  gcode: string,
  options: StartJobOptions,
  controllerEpoch: CncControllerEpoch,
): void {
  if (options.machineKind !== 'cnc') return;
  if (cncSetupAttestationMatches(options.cncSetupAttestation, gcode, controllerEpoch)) return;
  throw new Error(CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE);
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
  if (plannedChanges !== undefined && plannedChanges.length !== countM0Boundaries(gcode)) {
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

function countM0Boundaries(gcode: string): number {
  return gcode.split('\n').filter((line) => line.trim().toUpperCase() === 'M0').length;
}

function toolChangeEntryPatch(state: LaserState, entersHoldNow: boolean): Partial<LaserState> {
  // A short first tool section can reach M0 synchronously, before the ack path
  // sees a transition. Invalidate the old tool's Z evidence here too.
  return entersHoldNow
    ? {
        workZZeroEvidence: null,
        workZReferenceEpoch: state.workZReferenceEpoch + 1,
        toolChangeIdleSeen: false,
      }
    : {};
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

function captureStartSetupEpoch(state: LaserState): StartSetupEpoch {
  return cncControllerEpochOf(state);
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
async function runContinueToolChange(
  set: SetFn,
  get: GetFn,
  refs: ResetCleanupRefs & ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  if (get().streamer?.status !== 'tool-change') return;
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
    const stepped = step(continueToolChangeStreamer(s.streamer));
    toSend = stepped.toSend;
    // Continuing always consumes the current M0, so a resulting 'tool-change'
    // status is a NEW hold reached within this single fill. The ack-path
    // transition patch never sees it (status was already 'tool-change'), so the
    // prior tool's Z evidence, the stale toolChangeIdleSeen, and the tool label
    // would carry into the next hold — apply the shared entry patch here (F22).
    const enteredNextHold = stepped.state.status === 'tool-change';
    return {
      streamer: stepped.state,
      ...(enteredNextHold ? toolChangeHoldEntryPatch(s) : {}),
    };
  });
  if (toSend.length > 0) {
    try {
      await safeWrite(toSend, 'resume');
    } catch (err) {
      containActiveStreamWriteFailure(set, refs, safeWrite, 'resume');
      throw err;
    }
  }
}
