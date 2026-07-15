// laser-connection-actions — connect/disconnect + the status poll loop,
// extracted from laser-store.ts (ADR-015 size cap). Selects the active
// ControllerDriver at connect time (ADR-094) and opens the port at the
// profile's baud rate. Type-only LaserState/LiveRefs imports — no runtime
// cycle (same pattern as the sibling action modules).

import { selectControllerDriver } from '../../core/controllers';
import {
  claimIntentionalDisconnect,
  closeConnectionOnce,
  connectionForgetRequested,
  teardownConnectionRefs,
} from './laser-connection-teardown';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import { handleLine } from './laser-line-handler';
import {
  disconnectedControllerQualification,
  failedControllerQualificationPatch,
  qualifyingController,
} from './laser-controller-qualification';
import { runControllerHandshake } from './laser-controller-handshake';
import { recoveryRepository } from './recovery';
import {
  streamStalledNotice,
  writeFailedNotice,
  type LaserSafetyAction,
} from './laser-safety-notice';
import {
  assertAutofocusIdle,
  buildPortClosePatch,
  detectStreamStall,
  disconnectStopCommands,
  hasUnsettledStreamAcks,
  initialLaserState,
  isActiveJob,
  pushLog,
} from './laser-store-helpers';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { containLostStreamHeartbeat } from './laser-stream-heartbeat-containment';
import type { LaserState, LiveRefs } from './laser-store';
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
type LiveConnection = NonNullable<LiveRefs['connection']>;

const forgetFinalizations = new WeakMap<LiveConnection, Promise<void>>();

// 250 ms tick; idle machines only emit a status query every 4th tick.
const STATUS_POLL_MS = 250;
const IDLE_POLL_DIVISOR = 4;

export function connectionActions(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'connect' | 'disconnect' | 'forgetDevice'> {
  return {
    connect: async (adapter, options = {}) => {
      const previousConnection = refs.connection;
      if (previousConnection !== null) {
        try {
          if (isGrblFamilyDriver(refs.driver)) {
            await runGrblDisconnectTransaction(set, refs, safeWrite);
          }
        } catch {
          set({ safetyNotice: writeFailedNotice('disconnect') });
        }
        if (refs.connection === previousConnection) teardownConnectionRefs(refs);
        await closeConnectionOnce(previousConnection).catch(() => undefined);
      }
      refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
      refs.nextTranscriptId = 1;
      refs.driver = selectControllerDriver(options.controllerKind);
      set((state) => connectingStatePatch(state, refs));
      try {
        // Inside the try: requestPort throws on browsers without Web Serial
        // (TypeError) and on Chromium policy/concurrency errors. Thrown
        // outside, the store stayed at 'connecting' forever with both
        // Connect buttons disabled.
        const portRef = await adapter.serial.requestPort();
        if (portRef === null) {
          set((state) => ({
            connection: { kind: 'disconnected' },
            controllerQualification: disconnectedControllerQualification(
              state.controllerSessionEpoch,
            ),
          }));
          return;
        }
        const baudRate = options.baudRate ?? refs.driver.defaultBaudRate;
        const conn = await portRef.open({ baudRate });
        refs.connection = conn;
        // Pass safeWrite through whole: the line handler attaches action and
        // source metadata to its writes (post-error stop escalation, frame
        // dispatch, job refills) — a bare (out) => safeWrite(out) wrapper
        // silently drops both.
        refs.unsubscribeLine = conn.onLine((line) => {
          if (refs.connection !== conn) return;
          handleLine(set, get, refs, safeWrite, line);
        });
        refs.unsubscribeClose = conn.onClose(() => {
          if (refs.connection !== conn) return;
          teardownConnectionRefs(refs);
          set(buildPortClosePatch);
        });
        set(connectedControllerStatePatch);
        void runControllerHandshake(set, get, refs, safeWrite, baudRate)
          .catch((err: unknown) => {
            if (refs.connection !== conn) return;
            const message = err instanceof Error ? err.message : String(err);
            set((state) => ({
              ...failedControllerQualificationPatch(state, state.controllerSessionEpoch, message),
              lastWriteError: message,
              log: pushLog(state, `[lf2] Controller handshake failed: ${message}`),
            }));
          })
          .finally(() => {
            if (refs.connection !== conn) return;
            // A Disconnect/reset transaction replaces the handshake operation
            // with recovery and advances the serial epoch. Its abandoned raw
            // line wait must not restart polling into the teardown boundary.
            if (get().controllerOperation?.kind !== 'connection-handshake') return;
            set({ controllerOperation: null });
            startStatusPolling(set, get, refs, safeWrite);
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set((state) => ({
          connection: { kind: 'failed', error: message },
          controllerQualification: disconnectedControllerQualification(
            state.controllerSessionEpoch,
          ),
        }));
      }
    },
    disconnect: () => runDisconnect(set, get, refs, safeWrite, false),
    forgetDevice: () => runDisconnect(set, get, refs, safeWrite, true),
  };
}

function connectingStatePatch(state: LaserState, refs: LiveRefs): Partial<LaserState> {
  const nextEpoch = state.controllerSessionEpoch + 1;
  return {
    connection: { kind: 'connecting' },
    controllerSessionEpoch: nextEpoch,
    statusReport: null,
    statusObservation: null,
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: qualifyingController(nextEpoch, 'controller-response'),
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    homingProof: null,
    controllerOperation: null,
    probeBusy: false,
    log: [],
    transcript: [],
    homingState: 'unknown',
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    workZZeroEvidence: null,
    wcoCache: null,
    ovCache: null,
    accessoryCache: null,
    mpgActive: null,
    workOriginActive: false,
    workOriginSource: 'none',
    frameVerification: null,
    capabilities: refs.driver.capabilities,
    activeControllerKind: refs.driver.kind,
    detectedControllerKind: null,
  };
}

// A successful serial open does not acknowledge a prior machine-safety
// incident. Preserve it explicitly so reconnect and operator acknowledgment
// remain separate actions.
export function connectedControllerStatePatch(state: LaserState): Partial<LaserState> {
  return {
    connection: { kind: 'connected' },
    alarmCode: null,
    lastWriteError: null,
    safetyNotice: state.safetyNotice,
    airAssistOn: false,
    fireActive: false,
    controllerOperation: {
      kind: 'connection-handshake',
      phase: 'waiting-controller',
    },
    probeBusy: false,
    homingState: 'unknown',
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
  };
}

async function runDisconnect(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  forgetDevice: boolean,
): Promise<void> {
  assertAutofocusIdle(get());
  const closed = await closeControllerTransport(set, get, refs, safeWrite, forgetDevice);
  if (!closed.ownsFinalState) {
    if (forgetDevice && closed.connection !== null && refs.connection === null) {
      await finalizeForgottenControllerOnce(
        closed.connection,
        set,
        get,
        refs,
        closed.stopCouldNotBeConfirmed,
      );
    }
    return;
  }
  const forgetWasUpgraded =
    closed.connection !== null && connectionForgetRequested(closed.connection);
  if (forgetDevice || forgetWasUpgraded) {
    if (closed.connection === null) {
      await finalizeForgottenController(set, get, refs, closed.stopCouldNotBeConfirmed);
    } else {
      await finalizeForgottenControllerOnce(
        closed.connection,
        set,
        get,
        refs,
        closed.stopCouldNotBeConfirmed,
      );
    }
    return;
  }
  set((state) => ({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    statusObservation: null,
    detectedSettings: null,
    detectedControllerKind: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch + 1),
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    streamer: null,
    airAssistOn: false,
    fireActive: false,
    wcoCache: null,
    accessoryCache: null,
    mpgActive: null,
    workOriginActive: false,
    workOriginSource: 'none',
    workZZeroEvidence: null,
    frameVerification: null,
    motionOperation: null,
    controllerOperation: null,
    probeBusy: false,
    homingState: 'unknown',
    homingProof: null,
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    lastWriteError: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    ...liveCanvasLifecyclePatch(state, 'disconnected'),
  }));
}

async function closeControllerTransport(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  forgetDevice: boolean,
): Promise<{
  readonly connection: LiveConnection | null;
  readonly ownsFinalState: boolean;
  readonly stopCouldNotBeConfirmed: boolean;
}> {
  const connection = refs.connection;
  if (connection === null) {
    teardownConnectionRefs(refs);
    return { connection, ownsFinalState: true, stopCouldNotBeConfirmed: false };
  }
  const ownsFinalState = claimIntentionalDisconnect(connection);
  let stopCouldNotBeConfirmed = false;
  try {
    await stopBeforeDisconnect(set, get, refs, safeWrite);
  } catch {
    set({ safetyNotice: writeFailedNotice('disconnect') });
    stopCouldNotBeConfirmed = true;
  }
  if (!ownsFinalState) {
    await closeConnectionOnce(connection, forgetDevice).catch(() => undefined);
    return { connection, ownsFinalState: false, stopCouldNotBeConfirmed };
  }
  const stillOwnsConnection = refs.connection === connection;
  if (stillOwnsConnection) teardownConnectionRefs(refs);
  await closeConnectionOnce(connection, forgetDevice).catch(() => undefined);
  return {
    connection,
    ownsFinalState: stillOwnsConnection,
    stopCouldNotBeConfirmed,
  };
}

async function stopBeforeDisconnect(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Promise<void> {
  if (isGrblFamilyDriver(refs.driver)) {
    await runGrblDisconnectTransaction(set, refs, safeWrite);
    return;
  }
  for (const stopCommand of disconnectStopCommands(get(), refs.driver)) {
    await safeWrite(stopCommand, 'disconnect');
  }
}

function finalizeForgottenControllerOnce(
  connection: LiveConnection,
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  stopCouldNotBeConfirmed: boolean,
): Promise<void> {
  const existing = forgetFinalizations.get(connection);
  if (existing !== undefined) return existing;
  const finalization = finalizeForgottenController(set, get, refs, stopCouldNotBeConfirmed);
  forgetFinalizations.set(connection, finalization);
  return finalization;
}

async function finalizeForgottenController(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  stopCouldNotBeConfirmed: boolean,
): Promise<void> {
  await recoveryRepository.purgeControllerData();
  refs.driver = selectControllerDriver(undefined);
  const retainDisconnectWarning = stopCouldNotBeConfirmed || disconnectStopIsUncertain(get());
  set((state) => ({
    ...initialLaserState(),
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch + 1),
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    safetyNotice: retainDisconnectWarning ? writeFailedNotice('disconnect') : null,
  }));
}

function disconnectStopIsUncertain(state: LaserState): boolean {
  return state.safetyNotice?.kind === 'write-failed' && state.safetyNotice.action === 'disconnect';
}

function startStatusPolling(set: SetFn, get: GetFn, refs: LiveRefs, safeWrite: SafeWriteFn): void {
  const realtimeQuery = refs.driver.realtime.statusQuery;
  const queuedQuery = refs.driver.commands.queuedStatusQuery;
  if (realtimeQuery === null && queuedQuery === null) return;
  let pollTick = 0;
  refs.pollHandle = setInterval(() => {
    pollTick++;
    const s = get();
    if (containLostStreamHeartbeat(set, s, refs, safeWrite)) return;
    const stall = detectStreamStall(s.streamer, s.statusReport, refs.stallProbe, Date.now());
    refs.stallProbe = stall.probe;
    if (stall.stalled && s.safetyNotice === null) set({ safetyNotice: streamStalledNotice() });
    // Start owns this boundary: queue-fence must converge to zero without
    // background writes, and CNC live-status sends its own freshness query.
    // Polling here can otherwise keep pendingTransportWrites continuously
    // non-zero or race the explicitly owned Start observation.
    if (controllerOperationOwnsPolling(s)) return;
    if (realtimeQuery !== null) {
      if (!shouldFastPoll(s) && pollTick % IDLE_POLL_DIVISOR !== 0) return;
      void safeWrite(realtimeQuery).catch(() => undefined);
      return;
    }
    // Queued status query (Marlin M114): it consumes planner space and emits
    // its own ok, so NEVER poll while stream acks are outstanding (accounting
    // would desync) or while a controller command awaits its ack (the poll's
    // ok would resolve the wrong request). A 'done' stream with nothing in
    // flight DOES poll — the post-job settle needs Idle reports to finish.
    if (queuedQuery === null) return;
    if (!canSendQueuedStatusQuery(s, refs, pollTick)) return;
    void safeWrite(`${queuedQuery}\n`).catch(() => undefined);
  }, STATUS_POLL_MS);
}

function controllerOperationOwnsPolling(state: LaserState): boolean {
  const operation = state.controllerOperation;
  if (operation?.kind === 'start-arming') return true;
  return operation?.kind === 'recovery' && operation.phase === 'reset';
}

function canSendQueuedStatusQuery(state: LaserState, refs: LiveRefs, pollTick: number): boolean {
  if (hasUnsettledStreamAcks(state.streamer)) return false;
  if (state.pendingUntrackedAcks > 0 || (state.pendingTransportWrites ?? 0) > 0) return false;
  if (refs.controllerCommand !== null) return false;
  return shouldFastPoll(state) || pollTick % IDLE_POLL_DIVISOR === 0;
}

function shouldFastPoll(state: LaserState): boolean {
  return (
    isActiveJob(state.streamer) ||
    state.motionOperation !== null ||
    state.controllerOperation !== null ||
    state.autofocusBusy ||
    state.probeBusy
  );
}
