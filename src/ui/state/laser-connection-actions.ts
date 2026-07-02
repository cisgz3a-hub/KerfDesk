// laser-connection-actions — connect/disconnect + the status poll loop,
// extracted from laser-store.ts (ADR-015 size cap). Selects the active
// ControllerDriver at connect time (ADR-094) and opens the port at the
// profile's baud rate. Type-only LaserState/LiveRefs imports — no runtime
// cycle (same pattern as the sibling action modules).

import { idleCollector } from '../../core/controllers/grbl';
import { selectControllerDriver } from '../../core/controllers';
import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import { handleLine, runHandshake } from './laser-line-handler';
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
  isActiveJob,
} from './laser-store-helpers';
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

export function connectionActions(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
): Pick<LaserState, 'connect' | 'disconnect'> {
  return {
    connect: async (adapter, options = {}) => {
      refs.nextTranscriptId = 1;
      refs.driver = selectControllerDriver(options.controllerKind);
      set({
        connection: { kind: 'connecting' },
        controllerOperation: null,
        log: [],
        transcript: [],
        homingState: 'unknown',
        capabilities: refs.driver.capabilities,
      });
      const portRef = await adapter.serial.requestPort();
      if (portRef === null) {
        set({ connection: { kind: 'disconnected' } });
        return;
      }
      try {
        const conn = await portRef.open({
          baudRate: options.baudRate ?? refs.driver.defaultBaudRate,
        });
        refs.connection = conn;
        refs.unsubscribeLine = conn.onLine((line) =>
          handleLine(set, get, refs, (out) => safeWrite(out), line),
        );
        refs.unsubscribeClose = conn.onClose(() => {
          teardown(refs);
          set(buildPortClosePatch);
        });
        startStatusPolling(set, get, refs, safeWrite);
        set({
          connection: { kind: 'connected' },
          alarmCode: null,
          lastWriteError: null,
          safetyNotice: null,
          controllerOperation: null,
          homingState: 'unknown',
        });
        void runHandshake(set, get, refs, (out) => safeWrite(out)).catch(() => undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ connection: { kind: 'failed', error: message } });
      }
    },
    disconnect: () => runDisconnect(set, get, refs, safeWrite),
  };
}

async function runDisconnect(
  set: SetFn,
  get: GetFn,
  refs: LiveRefs,
  safeWrite: SafeWriteFn,
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
  if (conn !== null) await conn.close().catch(() => undefined);
  set({
    connection: { kind: 'disconnected' },
    statusReport: null,
    controllerSettings: null,
    grblSettingsRows: [],
    lastSettingsReadAt: null,
    streamer: null,
    wcoCache: null,
    workOriginActive: false,
    workOriginSource: 'none',
    frameVerification: null,
    motionOperation: null,
    controllerOperation: null,
    homingState: 'unknown',
    lastWriteError: null,
  });
}

function teardown(refs: LiveRefs): void {
  cancelControllerLifecycleRefs(refs);
  refs.unsubscribeLine?.();
  refs.unsubscribeClose?.();
  if (refs.pollHandle !== null) clearInterval(refs.pollHandle);
  refs.connection = null;
  refs.unsubscribeLine = null;
  refs.unsubscribeClose = null;
  refs.pollHandle = null;
  refs.settingsCollector = idleCollector();
  refs.onLineArrived = null;
  refs.nextTranscriptId = 1;
  refs.stallProbe = null;
  refs.controllerCommand = null;
  refs.controllerIdleWait = null;
}

function startStatusPolling(set: SetFn, get: GetFn, refs: LiveRefs, safeWrite: SafeWriteFn): void {
  const statusQuery = refs.driver.realtime.statusQuery;
  if (statusQuery === null) return; // no realtime report on this firmware
  let pollTick = 0;
  refs.pollHandle = setInterval(() => {
    pollTick++;
    const s = get();
    const stall = detectStreamStall(s.streamer, s.statusReport, refs.stallProbe, Date.now());
    refs.stallProbe = stall.probe;
    if (stall.stalled && s.safetyNotice === null) set({ safetyNotice: streamStalledNotice() });
    if (!shouldFastPoll(s) && pollTick % IDLE_POLL_DIVISOR !== 0) return;
    void safeWrite(statusQuery).catch(() => undefined);
  }, STATUS_POLL_MS);
}

function shouldFastPoll(state: LaserState): boolean {
  return (
    isActiveJob(state.streamer) ||
    state.motionOperation !== null ||
    state.controllerOperation !== null ||
    state.autofocusBusy
  );
}
