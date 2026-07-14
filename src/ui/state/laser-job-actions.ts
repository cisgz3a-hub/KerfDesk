// laser-job-actions — Start / Pause / Resume / Stop, extracted from
// laser-store.ts when it hit the ADR-015 size cap. Same shape as the other
// action modules (autofocus-action, origin-actions): a factory that receives
// the store's set/get plus the connection-bound safe write. Type-only
// LaserState import — no runtime cycle.

import {
  cancel as cancelStreamer,
  continueToolChange as continueToolChangeStreamer,
  createStreamer,
  findOversizedLine,
  markErrored,
  pause as pauseStreamer,
  resume as resumeStreamer,
  step,
  wipeInFlight,
  type CreateStreamerOptions,
} from '../../core/controllers/grbl';
import type { ControllerDriver } from '../../core/controllers';
import { extractToolChangeLabels } from '../../core/output';
import { normalizeGrblRxBufferBytes } from '../../core/grbl-streaming';
import {
  CNC_SETUP_ATTESTATION_REQUIRED_MESSAGE,
  cncControllerEpochOf,
  cncSetupAttestationMatches,
  type CncControllerEpoch,
} from './cnc-setup-attestation';
import { cncResumeBlockMessage } from './cnc-pause-resume-policy';
import {
  assertCncControllerOwnershipClean,
  assertCncLiveStartReady,
  assertCncMpgInactive,
  refreshCncLiveStartState,
} from './cnc-live-start-readiness';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import { invalidateControllerSessionEvidence } from './laser-controller-evidence';
import { startControllerCommand, type ControllerLifecycleRefs } from './laser-interactive-command';
import { armResetCleanup, type ResetCleanupRefs } from './laser-reset-cleanup';
import { writeFailedNotice, type LaserSafetyAction } from './laser-safety-notice';
import {
  assertAutofocusIdle,
  pushLog,
  setupCommandBlockMessage,
  toolChangeContinueBlockMessage,
} from './laser-store-helpers';
import type { LaserState, StartJobOptions } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type SafeWriteFn = (line: string, action?: LaserSafetyAction) => Promise<void>;
type DriverFn = () => ControllerDriver;
type StartSetupEpoch = CncControllerEpoch;

const PAUSE_REQUIRES_LASER_MODE_MESSAGE =
  'Pause requires confirmed GRBL laser mode ($32=1). Use Stop instead; feed hold can leave the laser on when $32=0 or unknown.';
const PAUSE_UNSUPPORTED_MESSAGE =
  'This controller has no realtime feed hold. Pause is stream-side only: sending stops, but buffered motion finishes. Use Stop for an immediate halt.';
// GRBL acks in strict receive order: an ok still owed to a console/origin/
// handshake write, mis-attributed to a fresh job stream, frees RX budget the
// controller has not freed — the phantom refill can overflow the real buffer
// mid-burn. Start briefly waits for the owed acks; a controller that stays
// silent past this budget is a connection problem the operator must see.
const UNTRACKED_ACK_DRAIN_TIMEOUT_MS = 1_500;
const UNTRACKED_ACK_DRAIN_POLL_MS = 25;
const START_PENDING_ACK_MESSAGE =
  'A previous controller write is still in transport or awaiting acknowledgement. Start was ' +
  'blocked so its terminal response cannot corrupt the job stream — check the connection and try again.';

export const TOOL_CHANGE_PLAN_MISMATCH_MESSAGE =
  'The compiled tool plan does not match the CNC program pauses. Start was blocked so tool identity cannot drift at a change boundary.';

export function jobActions(
  set: SetFn,
  get: GetFn,
  refs: ResetCleanupRefs & ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Pick<LaserState, 'startJob' | 'pauseJob' | 'resumeJob' | 'stopJob' | 'continueToolChange'> {
  return {
    continueToolChange: () => runContinueToolChange(set, get, safeWrite),
    startJob: async (gcode, options = {}) => {
      assertStartAllowed(set, get);
      const setupEpoch = captureStartSetupEpoch(get());
      set({ controllerOperation: { kind: 'start-arming', phase: 'queue-fence' } });
      try {
        if (hasPendingControllerWrite(get())) {
          await waitForUntrackedAckDrain(get);
          assertStartAllowed(set, get, true);
        }
        assertCncSetupAttested(gcode, options, setupEpoch);
        const machineKind = options.machineKind ?? 'laser';
        assertCncControllerOwnershipClean(set, get, machineKind);
        assertCncMpgInactive(set, get, machineKind);
        if (machineKind === 'cnc') {
          await startControllerCommand(refs, safeWrite, {
            kind: 'start-arming',
            label: 'CNC Start queue fence',
            command: `${driver().commands.settleDwell}\n`,
            timeoutMs: UNTRACKED_ACK_DRAIN_TIMEOUT_MS,
          });
        }
        assertStartReservation(get, setupEpoch);
        await refreshCncLiveStartState(set, get, safeWrite, driver, machineKind);
        assertStartAllowed(set, get, true);
        assertCncLiveStartReady(set, get, machineKind);
        assertStartReservation(get, setupEpoch);
        if (hasPendingControllerWrite(get())) throw new Error(START_PENDING_ACK_MESSAGE);
        assertGcodeFitsController(gcode, options);
        const { stepped, labels, toolIds } = prepareInitialStream(gcode, options);
        const entersHoldNow = stepped.state.status === 'tool-change';
        set((state) => ({
          streamer: stepped.state,
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
        } catch (err) {
          set({ streamer: null });
          throw err;
        }
      } finally {
        set((state) => ({
          controllerOperation:
            state.controllerOperation?.kind === 'start-arming' ? null : state.controllerOperation,
        }));
      }
    },
    pauseJob: () => runPauseJob(set, get, safeWrite, driver),
    resumeJob: () => runResumeJob(set, get, safeWrite, driver),
    stopJob: () => runStopJob(set, refs, safeWrite, driver),
  };
}

async function runStopJob(
  set: SetFn,
  refs: ResetCleanupRefs & ControllerLifecycleRefs,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Promise<void> {
  const softReset = driver().realtime.softReset;
  if (softReset !== null) {
    set((state) => invalidateControllerSessionEvidence(state));
    await safeWrite(softReset, 'stop');
  }
  if (softReset === null) {
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
    ...originPatchAfterSoftReset(state),
    streamer:
      state.streamer === null
        ? state.streamer
        : softReset !== null
          ? wipeInFlight(cancelStreamer(state.streamer))
          : cancelStreamer(state.streamer),
  }));
  if (softReset !== null) armResetCleanup(refs, safeWrite, driver().commands.stopLaserLines);
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
    if (Date.now() > deadline) throw new Error(START_PENDING_ACK_MESSAGE);
    await sleep(UNTRACKED_ACK_DRAIN_POLL_MS);
  }
}

function hasPendingControllerWrite(state: LaserState): boolean {
  return state.pendingUntrackedAcks > 0 || (state.pendingTransportWrites ?? 0) > 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runPauseJob(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Promise<void> {
  const activeDriver = driver();
  const hold = activeDriver.realtime.hold;
  // Realtime feed hold pauses motion instantly but leaves the beam state
  // to the firmware — only provable safe when $32 laser mode is
  // confirmed. ADR-096's exemption is for firmwares that CANNOT report
  // $-settings (settings 'none': Smoothieware ties beam power to motion
  // in its laser module; Marlin has no hold byte and pauses stream-side).
  // Firmwares that CAN report — writable ('grbl-dollar') or read-only
  // ('readonly-dump', FluidNC's $$ compat dump) — keep the strict gate
  // (audit F6). Router jobs are exempt: feed hold with a spindle is
  // standard sender behavior (motion holds, spindle keeps spinning), and
  // a router must have $32=0 — demanding the laser proof would block CNC
  // pause outright.
  const requiresLaserModeProof =
    hold !== null &&
    activeDriver.capabilities.settings !== 'none' &&
    get().activeJobMachineKind !== 'cnc';
  if (requiresLaserModeProof) assertPauseSafe(set, get);
  if (hold !== null) await safeWrite(hold, 'pause');
  const s = get().streamer;
  if (s !== null) set({ streamer: pauseStreamer(s) });
  if (hold === null) {
    get().pushSystemNotice(`[lf2] ${PAUSE_UNSUPPORTED_MESSAGE}`);
  }
}

async function runResumeJob(
  set: SetFn,
  get: GetFn,
  safeWrite: SafeWriteFn,
  driver: DriverFn,
): Promise<void> {
  const cncBlockMessage = cncResumeBlockMessage(get().activeJobMachineKind);
  if (cncBlockMessage !== null) {
    set({
      lastWriteError: cncBlockMessage,
      log: pushLog(get(), `[lf2] CNC Resume blocked: ${cncBlockMessage}`),
    });
    throw new Error(cncBlockMessage);
  }
  const resumeByte = driver().realtime.resume;
  if (resumeByte !== null) await safeWrite(resumeByte, 'resume');
  // Functional set so the snapshot is taken AT WRITE TIME — during
  // the await above, ack-driven handleLine paths can have advanced
  // the streamer via advanceStream. A `const s = get().streamer`
  // before the set would clobber those concurrent updates with a
  // state derived from a stale snapshot, drifting the in-flight
  // accounting against the real GRBL 127-byte buffer (R-H2 audit
  // finding). On a laser cutter, accounting drift can push more
  // bytes than the buffer holds → dropped commands → uncontrolled
  // head motion.
  let toSend = '';
  set((s) => {
    if (s.streamer === null) return s;
    const stepped = step(resumeStreamer(s.streamer));
    toSend = stepped.toSend;
    return { streamer: stepped.state };
  });
  if (toSend.length > 0) {
    try {
      await safeWrite(toSend, 'resume');
    } catch (err) {
      // markErrored, not disconnect: 'disconnected' falls outside
      // isActiveJob, which unmounts the Stop button and drops the
      // soft-reset stop command while GRBL may still be executing
      // buffered lines on a live port. 'errored' keeps the recovery
      // controls mounted; step() sends nothing further either way.
      set((s) => ({
        streamer: s.streamer === null ? s.streamer : markErrored(s.streamer),
        safetyNotice: writeFailedNotice('resume'),
      }));
      throw err;
    }
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
    return { streamer: stepped.state };
  });
  if (toSend.length > 0) {
    try {
      await safeWrite(toSend, 'resume');
    } catch (err) {
      set((s) => ({
        streamer: s.streamer === null ? s.streamer : markErrored(s.streamer),
        safetyNotice: writeFailedNotice('resume'),
      }));
      throw err;
    }
  }
}

function originPatchAfterSoftReset(
  state: LaserState,
): Pick<
  LaserState,
  'workOriginActive' | 'workOriginSource' | 'workZZeroEvidence' | 'workZReferenceEpoch'
> {
  // A soft reset voids the bit-to-stock Z relationship (Codex audit P1).
  if (state.workOriginSource === 'g54-persistent' || state.workOriginSource === 'unknown') {
    return {
      workOriginActive: true,
      workOriginSource: 'unknown',
      workZZeroEvidence: null,
      workZReferenceEpoch: state.workZReferenceEpoch + 1,
    };
  }
  return {
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
  };
}

function normalizeStartJobOptions(options: CreateStreamerOptions): CreateStreamerOptions {
  return {
    ...options,
    rxBufferBytes: normalizeGrblRxBufferBytes(options.rxBufferBytes),
  };
}

function assertPauseSafe(set: SetFn, get: GetFn): void {
  const blockedMessage = pauseLaserModeBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Pause blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

function pauseLaserModeBlockMessage(state: LaserState): string | null {
  return state.controllerSettings?.laserModeEnabled === true
    ? null
    : PAUSE_REQUIRES_LASER_MODE_MESSAGE;
}
