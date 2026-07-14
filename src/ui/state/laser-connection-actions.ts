// laser-connection-actions — connect/disconnect + the status poll loop,
// extracted from laser-store.ts (ADR-015 size cap). Selects the active
// ControllerDriver at connect time (ADR-094) and opens the port at the
// profile's baud rate. Type-only LaserState/LiveRefs imports — no runtime
// cycle (same pattern as the sibling action modules).

import { idleCollector } from '../../core/controllers/grbl';
import { selectControllerDriver } from '../../core/controllers';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import { beginSettingsCollection } from './detected-settings-action';
import { handleLine, type HandlerRefs } from './laser-line-handler';
import { cancelResetCleanup } from './laser-reset-cleanup';
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
  isActiveJob,
  pushLog,
} from './laser-store-helpers';
import { liveCanvasLifecyclePatch } from './live-canvas-run';
import { appendSystemNotice } from './laser-system-notice';
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

// 250 ms tick; idle machines only emit a status query every 4th tick.
const STATUS_POLL_MS = 250;
const IDLE_POLL_DIVISOR = 4;
const PASSIVE_STARTUP_WAIT_MS = 250;
const ACTIVE_HANDSHAKE_WAIT_MS = 1750;
const LATE_BANNER_SETTLE_MS = 300;

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
        teardown(refs);
        await previousConnection.close().catch(() => undefined);
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
          set({ connection: { kind: 'disconnected' } });
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
          teardown(refs);
          set(buildPortClosePatch);
        });
        set({
          connection: { kind: 'connected' },
          alarmCode: null,
          lastWriteError: null,
          safetyNotice: null,
          airAssistOn: false,
          fireActive: false,
          controllerOperation: null,
          probeBusy: false,
          homingState: 'unknown',
          pendingUntrackedAcks: 0,
          pendingTransportWrites: 0,
        });
        void runHandshake(set, get, refs, safeWrite, baudRate)
          .catch(() => undefined)
          .finally(() => {
            if (refs.connection === conn) startStatusPolling(set, get, refs, safeWrite);
          });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ connection: { kind: 'failed', error: message } });
      }
    },
    disconnect: () => runDisconnect(set, get, refs, safeWrite, false),
    forgetDevice: () => runDisconnect(set, get, refs, safeWrite, true),
  };
}

function connectingStatePatch(state: LaserState, refs: LiveRefs): Partial<LaserState> {
  return {
    connection: { kind: 'connecting' },
    controllerSessionEpoch: state.controllerSessionEpoch + 1,
    statusObservation: null,
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
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
    capabilities: refs.driver.capabilities,
    activeControllerKind: refs.driver.kind,
    detectedControllerKind: null,
    mpgActive: null,
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
  const conn = refs.connection;
  const stopCommands = disconnectStopCommands(get(), refs.driver);
  if (stopCommands.length > 0) {
    try {
      for (const stopCommand of stopCommands) {
        await safeWrite(stopCommand, 'disconnect');
      }
    } catch {
      // The stop-before-disconnect write failed (USB likely already gone),
      // so the machine may still run buffered commands. Warn — but STILL
      // tear down the link the operator asked to drop (don't rethrow).
      set({ safetyNotice: writeFailedNotice('disconnect') });
    }
  }
  teardown(refs);
  if (conn !== null) {
    const close = forgetDevice && conn.forget !== undefined ? conn.forget : conn.close;
    await close().catch(() => undefined);
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

// Establish a quiet startup boundary before sending the queued settings query.
// A status poll used to trigger `$$` immediately; a delayed welcome banner could
// then reset the ack ledger before the query's `ok`, falsely reporting that
// reply as unowned on the next jog. Wait briefly for a passive banner, use only
// a realtime status probe when needed, and give a non-banner first line one
// final settle window before any ack-producing command is sent.
async function runHandshake(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: (line: string) => Promise<void>,
  baudRate: number,
): Promise<void> {
  const connection = refs.connection;
  if (connection === null) return;
  let expectedWriteEpoch = refs.writeEpoch ?? 0;
  let sawWelcomeBoundary = false;
  const acceptControllerLineEpoch = (): boolean => {
    if (refs.connection !== connection) return false;
    const currentWriteEpoch = refs.writeEpoch ?? 0;
    if (currentWriteEpoch === expectedWriteEpoch) return true;
    // The first welcome banner is the expected controller-reset boundary for
    // a new port. Adopt that one epoch after the line has identified firmware;
    // all later awaits are strict so a reset during settle still aborts.
    if (currentWriteEpoch === expectedWriteEpoch + 1 && get().detectedControllerKind !== null) {
      expectedWriteEpoch = currentWriteEpoch;
      sawWelcomeBoundary = true;
      return true;
    }
    return false;
  };
  let gotLine = await waitForNextControllerLine(refs, PASSIVE_STARTUP_WAIT_MS);
  if (!acceptControllerLineEpoch()) return;
  if (!gotLine) {
    const realtimeQuery = refs.driver.realtime.statusQuery;
    const nextLine = waitForNextControllerLine(refs, ACTIVE_HANDSHAKE_WAIT_MS);
    if (realtimeQuery !== null) {
      await safeWrite(realtimeQuery);
      if (!acceptControllerLineEpoch()) return;
    }
    gotLine = await nextLine;
    if (!acceptControllerLineEpoch()) return;
  }

  if (!gotLine) {
    const driver = refs.driver;
    set(
      appendSystemNotice(
        get(),
        refs,
        `[lf2] No controller response within 2 s. Check baud rate (${baudRate}) and that the device is ${driver.label}.`,
      ),
    );
    return;
  }
  await settleAfterControllerLine(sawWelcomeBoundary);
  if (!acceptControllerLineEpoch()) return;
  const settingsQuery = refs.driver.commands.settingsQuery;
  if (settingsQuery === null) {
    set({ log: pushLog(get(), '[lf2] Connected.') });
    return;
  }
  set({
    log: pushLog(get(), `[lf2] Connected. Querying settings (${settingsQuery})...`),
    detectedSettings: null,
    controllerSettings: null,
    controllerSettingsObservation: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
  });
  beginSettingsCollection(refs, get().controllerSessionEpoch);
  await safeWrite(`${settingsQuery}\n`);
  if (!handshakeIsCurrent(refs, connection, expectedWriteEpoch)) return;
}

function settleAfterControllerLine(sawWelcomeBoundary: boolean): Promise<void> {
  if (sawWelcomeBoundary) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, LATE_BANNER_SETTLE_MS));
}

function waitForNextControllerLine(refs: HandlerRefs, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (gotLine: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(gotLine);
    };
    const onLineArrived = (): void => {
      clearTimeout(timer);
      if (refs.onLineArrived === onLineArrived) refs.onLineArrived = null;
      settle(true);
    };
    const timer = setTimeout(() => {
      if (refs.onLineArrived === onLineArrived) refs.onLineArrived = null;
      settle(false);
    }, timeoutMs);
    refs.onLineArrived = onLineArrived;
  });
}

function handshakeIsCurrent(
  refs: LiveRefs,
  connection: NonNullable<LiveRefs['connection']>,
  writeEpoch: number,
): boolean {
  return refs.connection === connection && (refs.writeEpoch ?? 0) === writeEpoch;
}

function teardown(refs: LiveRefs): void {
  refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
  cancelControllerLifecycleRefs(refs);
  cancelResetCleanup(refs);
  refs.unsubscribeLine?.();
  refs.unsubscribeClose?.();
  if (refs.pollHandle !== null) clearInterval(refs.pollHandle);
  refs.connection = null;
  refs.unsubscribeLine = null;
  refs.unsubscribeClose = null;
  refs.pollHandle = null;
  refs.settingsCollector = idleCollector();
  refs.settingsCollectorSessionEpoch = null;
  refs.onLineArrived = null;
  refs.nextTranscriptId = 1;
  refs.stallProbe = null;
  refs.controllerCommand = null;
  refs.controllerIdleWait = null;
  refs.controllerResetWait = null;
}

function startStatusPolling(set: SetFn, get: GetFn, refs: LiveRefs, safeWrite: SafeWriteFn): void {
  const realtimeQuery = refs.driver.realtime.statusQuery;
  const queuedQuery = refs.driver.commands.queuedStatusQuery;
  if (realtimeQuery === null && queuedQuery === null) return;
  let pollTick = 0;
  refs.pollHandle = setInterval(() => {
    pollTick++;
    const s = get();
    const stall = detectStreamStall(s.streamer, s.statusReport, refs.stallProbe, Date.now());
    refs.stallProbe = stall.probe;
    if (stall.stalled && s.safetyNotice === null) set({ safetyNotice: streamStalledNotice() });
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
