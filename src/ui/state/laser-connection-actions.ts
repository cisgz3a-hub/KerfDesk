// laser-connection-actions — connect/disconnect + the status poll loop,
// extracted from laser-store.ts (ADR-015 size cap). Selects the active
// ControllerDriver at connect time (ADR-094) and opens the port at the
// profile's baud rate. Type-only LaserState/LiveRefs imports — no runtime
// cycle (same pattern as the sibling action modules).

import { selectControllerDriver } from '../../core/controllers';
import { runConnectAction } from './laser-connect-action';
import { cancelConnectAttempt } from './laser-connect-attempt';
import {
  closeConnectionOnce,
  connectionForgetRequested,
  quarantineConnectionRefs,
  runIntentionalDisconnectOnce,
  teardownConnectionRefs,
  type IntentionalDisconnectRequest,
} from './laser-connection-teardown';
import { isGrblFamilyDriver, runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import { handleLine } from './laser-line-handler';
import {
  disconnectedControllerQualification,
  failedControllerQualificationPatch,
  qualifyingController,
} from './laser-controller-qualification';
import { controllerHandshakeOwnership, runControllerHandshake } from './laser-controller-handshake';
import { recoveryRepository } from './recovery';
import {
  streamStalledNotice,
  writeFailedNotice,
  type LaserSafetyAction,
  type LaserSafetyNotice,
} from './laser-safety-notice';
import {
  retainedDisconnectSafetyNotice,
  retainedUnavailableTransportSafetyNotice,
  safetyNoticeLeavesPhysicalStopUncertain,
  unconfirmedDisconnectStopNotice,
  withRetainedDisconnectSafety,
} from './laser-disconnect-safety';
import { disconnectedStatePatch } from './laser-disconnected-state';
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
import { containLostStreamHeartbeat } from './laser-stream-heartbeat-containment';
import type { LaserState, LiveRefs } from './laser-store';
import { useToastStore } from './toast-store';
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
    connect: (adapter, options = {}) =>
      runConnectAction(
        set,
        refs,
        adapter,
        options,
        (connection) => closeConnectionForReplacement(set, get, refs, safeWrite, connection),
        connectingStatePatch,
        (connection, baudRate) =>
          attachConnectedController(set, get, refs, safeWrite, connection, baudRate),
      ),
    disconnect: () => {
      cancelConnectAttempt(refs, false);
      return runDisconnect(set, get, refs, safeWrite, false);
    },
    forgetDevice: () => {
      cancelConnectAttempt(refs, true);
      return runDisconnect(set, get, refs, safeWrite, true);
    },
  };
}

async function closeConnectionForReplacement(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: LiveConnection,
): Promise<void> {
  await runIntentionalDisconnectOnce(refs, connection, false, (request) =>
    runOwnedIntentionalDisconnect(set, get, refs, safeWrite, connection, request),
  ).catch(() => undefined);
}

function attachConnectedController(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: LiveConnection,
  baudRate: number,
): void {
  refs.connection = connection;
  refs.unsubscribeLine = connection.onLine((line) => {
    if (refs.connection !== connection) return;
    handleLine(set, get, refs, safeWrite, line);
  });
  refs.unsubscribeClose = connection.onClose(() => {
    if (refs.connection !== connection) return;
    teardownConnectionRefs(refs);
    set(buildPortClosePatch);
  });
  set(connectedControllerStatePatch);
  startConnectedControllerHandshake(set, get, refs, safeWrite, connection, baudRate);
}

function startConnectedControllerHandshake(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: LiveConnection,
  baudRate: number,
): void {
  const ownership = controllerHandshakeOwnership(get, refs, connection);
  void runControllerHandshake(set, get, refs, safeWrite, baudRate, ownership.adopt)
    .catch((error: unknown) => {
      if (!ownership.isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      set((state) =>
        state.controllerSessionEpoch === ownership.qualificationEpoch
          ? {
              ...failedControllerQualificationPatch(state, ownership.qualificationEpoch, message),
              lastWriteError: message,
              log: pushLog(state, `[lf2] Controller handshake failed: ${message}`),
            }
          : {},
      );
    })
    .finally(() => {
      if (!ownership.isCurrent()) return;
      // A reset transaction replaces the handshake and owns subsequent polling.
      if (get().controllerOperation?.kind !== 'connection-handshake') return;
      set({ controllerOperation: null });
      startStatusPolling(set, get, refs, safeWrite);
    });
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
    activeWcs: null,
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
  const connection = refs.connection;
  if (connection === null) {
    teardownConnectionRefs(refs);
    if (forgetDevice) {
      await finalizeForgottenController(
        set,
        get,
        refs,
        retainedUnavailableTransportSafetyNotice(get()),
      );
    }
    return;
  }
  await runIntentionalDisconnectOnce(
    refs,
    connection,
    forgetDevice,
    (request) => runOwnedIntentionalDisconnect(set, get, refs, safeWrite, connection, request),
    () =>
      finalizeForgottenControllerOnce(
        connection,
        set,
        get,
        refs,
        retainedDisconnectSafetyNotice(get()),
      ),
  );
}

async function runOwnedIntentionalDisconnect(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
  connection: LiveConnection,
  request: IntentionalDisconnectRequest,
): Promise<void> {
  let retainedSafetyNotice = unconfirmedDisconnectStopNotice(get(), refs.driver);
  try {
    await stopBeforeDisconnect(set, get, refs, safeWrite);
  } catch {
    retainedSafetyNotice = writeFailedNotice('disconnect');
    set({ safetyNotice: retainedSafetyNotice });
  }
  if (refs.connection === connection) quarantineConnectionRefs(refs);
  let closeError: unknown = null;
  try {
    await closeConnectionOnce(refs, connection, request.forgetRequested);
  } catch (error) {
    closeError = error;
    retainedSafetyNotice = writeFailedNotice('disconnect');
    set({ safetyNotice: retainedSafetyNotice });
  }
  const ownsFinalState = refs.connection === connection;
  if (ownsFinalState) refs.connection = null;
  const forgetWasRequested = request.forgetRequested || connectionForgetRequested(refs, connection);
  if (forgetWasRequested) {
    await finalizeForgottenControllerOnce(connection, set, get, refs, retainedSafetyNotice);
  } else if (ownsFinalState) {
    set((state) =>
      withRetainedDisconnectSafety(disconnectedStatePatch(state), retainedSafetyNotice),
    );
  }
  if (closeError !== null) {
    throw closeError instanceof Error ? closeError : new Error(String(closeError));
  }
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
  const state = get();
  const ordinaryStopCommands = disconnectStopCommands(state, refs.driver);
  const stopCommands =
    ordinaryStopCommands.length === 0 &&
    state.safetyNotice !== null &&
    safetyNoticeLeavesPhysicalStopUncertain(state.safetyNotice)
      ? [
          ...(refs.driver.realtime.softReset === null ? [] : [refs.driver.realtime.softReset]),
          ...refs.driver.commands.stopLaserLines.map((line) => `${line}\n`),
        ]
      : ordinaryStopCommands;
  for (const stopCommand of stopCommands) {
    await safeWrite(stopCommand, 'disconnect');
  }
}

function finalizeForgottenControllerOnce(
  connection: LiveConnection,
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  retainedSafetyNotice: LaserSafetyNotice | null,
): Promise<void> {
  const existing = refs.forgetFinalizations.get(connection);
  if (existing !== undefined) return existing;
  const finalization = finalizeForgottenController(set, get, refs, retainedSafetyNotice);
  refs.forgetFinalizations.set(connection, finalization);
  return finalization;
}

async function finalizeForgottenController(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  retainedSafetyNotice: LaserSafetyNotice | null,
): Promise<void> {
  const safetyNotice = retainedSafetyNotice ?? retainedDisconnectSafetyNotice(get());
  // purgeControllerData clears its published recovery snapshot and writes the
  // deletion generation before its first await. Start it, then reset the live
  // controller state immediately so a slow IndexedDB delete cannot leave a
  // closed port looking connected and qualified.
  const purge = recoveryRepository.purgeControllerData();
  refs.driver = selectControllerDriver(undefined);
  set((state) => ({
    ...initialLaserState(),
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    controllerQualification: disconnectedControllerQualification(state.controllerSessionEpoch + 1),
    trustedPositionEpoch: (state.trustedPositionEpoch ?? 0) + 1,
    workZReferenceEpoch: state.workZReferenceEpoch + 1,
    safetyNotice,
  }));

  let purgeWarning: string | null = null;
  try {
    const purged = await purge;
    if (!purged.ok) purgeWarning = `recovery storage reported ${purged.error}`;
  } catch (error) {
    purgeWarning = error instanceof Error ? error.message : String(error);
  }
  if (purgeWarning !== null) {
    useToastStore
      .getState()
      .pushToast(
        `Controller state was reset, but recovery storage could not be purged: ${purgeWarning}`,
        'warning',
      );
  }
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
