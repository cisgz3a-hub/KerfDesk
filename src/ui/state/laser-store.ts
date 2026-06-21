// laser-store — Zustand store for the live serial connection to the GRBL
import { create } from 'zustand';
import {
  CMD_UNLOCK,
  type GrblSettingRow,
  RT_JOG_CANCEL,
  RT_STATUS,
  buildJogCommand,
  idleCollector,
  type JogParams,
  type SettingsCollectorState,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import type { DeviceProfile } from '../../core/devices';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { type AutofocusResult, runAutofocus } from './autofocus-action';
import { consoleActions, type ConsoleCommandOptions } from './laser-console-actions';
import type { LaserControllerOperation } from './laser-controller-operation';
import { controllerRecoveryActions } from './laser-controller-recovery-actions';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { grblSettingsActions } from './grbl-settings-actions';
import { runHomeAction } from './laser-home-action';
import {
  cancelControllerLifecycleRefs,
  type ControllerLifecycleRefs,
} from './laser-interactive-command';
import { jobActions } from './laser-job-actions';
import { handleLine, runHandshake } from './laser-line-handler';
import {
  buildFrameJogLines,
  markMotionOperationDispatched,
  startMotionOperation,
  type LaserMotionOperation,
} from './laser-motion-operation';
import { type WorkCoordinateOffset } from './origin-actions';
import { originActions } from './laser-origin-actions';
import type { FrameVerification } from './frame-verification';
import {
  type LaserSafetyNotice,
  streamStalledNotice,
  writeFailedNotice,
} from './laser-safety-notice';
import { createSafeWrite } from './laser-safe-write';
import { setupActions } from './laser-setup-actions';
import { type SerialTranscriptEntry, type TranscriptSource } from './laser-transcript';
import {
  activeJobCommandBlockMessage,
  assertAutofocusIdle,
  buildPortClosePatch,
  detectStreamStall,
  disconnectStopCommands,
  initialLaserState,
  isActiveJob,
  jogFrameCommandBlockMessage,
  motionOperationCommandBlockMessage,
  pushLog,
  type StallProbe,
} from './laser-store-helpers';

export type { AutofocusResult } from './autofocus-action';
export { describeAutofocusResult } from './autofocus-action';
export { hasCustomOrigin } from './origin-actions';
export type { WorkCoordinateOffset } from './origin-actions';

const DEFAULT_BAUD = 115200;
// 250 ms tick; idle machines only emit `?` every 4th tick.
const STATUS_POLL_MS = 250;
const IDLE_POLL_DIVISOR = 4;

export type ConnectionState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | { readonly kind: 'failed'; readonly error: string };
export type HomingState = 'unknown' | 'homing' | 'confirmed';

export type LaserState = {
  readonly connection: ConnectionState;
  readonly statusReport: StatusReport | null;
  readonly alarmCode: number | null;
  readonly lastError: number | null;
  readonly lastWriteError: string | null;
  // P0-B: operator-facing safety alert raised when the store cannot guarantee
  // the machine is safe — a failed Stop/Pause/Resume/Disconnect write, or a USB
  // drop mid-job. null = nothing to warn about. Cleared on the next successful
  // connect or via clearSafetyNotice.
  readonly safetyNotice: LaserSafetyNotice | null;
  readonly autofocusBusy: boolean;
  readonly motionOperation: LaserMotionOperation | null;
  readonly controllerOperation: LaserControllerOperation | null;
  readonly streamer: StreamerState | null;
  readonly homingState: HomingState;
  readonly log: ReadonlyArray<string>;
  readonly transcript: ReadonlyArray<SerialTranscriptEntry>;
  // F-7: settings auto-detected from the `$$` dump on connect. Non-null
  // means "the user hasn't responded to the detection banner yet" —
  // null after either Apply (which dispatched updateDeviceProfile) or
  // Dismiss (which left the profile alone).
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly grblSettingsRows: ReadonlyArray<GrblSettingRow>;
  readonly lastSettingsReadAt: number | null;
  /**
   * F.3 — last-seen Work Coordinate Offset from the GRBL controller.
   * GRBL only reports WCO on a cadence (~every Nth status frame), so
   * the UI needs the *last non-null* value cached here, not the raw
   * StatusReport.wco which is null on most frames. Updated by the
   * line-handler when a WCO-bearing status arrives; cleared on
   * disconnect, alarm, and soft reset (all of which clear G92 in
   * GRBL itself). UI reads `wcoCache`, NEVER `statusReport.wco`.
   */
  readonly wcoCache: WorkCoordinateOffset | null;
  readonly workOriginActive: boolean;
  /**
   * ADR-053 P2 — proof that a clean Verified Frame ran for the current job at
   * the current origin. Set when a frame is dispatched in 'verified-origin'
   * mode; required by Start in that mode. Cleared whenever the origin or
   * connection changes (set/reset origin, disconnect, port close) or a frame is
   * cancelled, and invalidated structurally when the job moves/resizes (the
   * bounds signature stops matching). null = not verified.
   */
  readonly frameVerification: FrameVerification | null;

  readonly connect: (adapter: PlatformAdapter) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly home: () => Promise<void>;
  readonly autofocus: (command: string) => Promise<AutofocusResult>;
  readonly unlockAlarm: () => Promise<void>;
  readonly wakeController: () => Promise<void>;
  readonly configureGrblLaserSetup: () => Promise<void>;
  readonly readMachineSettings: () => Promise<void>;
  readonly writeGrblSetting: (id: number, value: string) => Promise<void>;
  readonly sendConsoleCommand: (command: string, options?: ConsoleCommandOptions) => Promise<void>;
  readonly clearTranscript: () => void;
  readonly jog: (params: JogParams) => Promise<void>;
  readonly cancelJog: () => Promise<void>;
  readonly frame: (
    bounds: {
      readonly minX: number;
      readonly minY: number;
      readonly maxX: number;
      readonly maxY: number;
    },
    feed: number,
  ) => Promise<void>;
  readonly startJob: (gcode: string) => Promise<void>;
  readonly pauseJob: () => Promise<void>;
  readonly resumeJob: () => Promise<void>;
  readonly stopJob: () => Promise<void>;
  readonly clearSafetyNotice: () => void;
  readonly applyDetectedSettings: () => void;
  readonly dismissDetectedSettings: () => void;
  // F.3 origin actions. setOriginHere sends G92 X0 Y0 (transient,
  // session-scoped); resetOrigin sends G92.1 to clear it. Cache
  // updates flow back through line-handler when GRBL's next
  // WCO-bearing status arrives.
  readonly setOriginHere: () => Promise<void>;
  readonly resetOrigin: () => Promise<void>;
  // ADR-053 P4 — $SLP to release the steppers for hand-positioning. Drops the
  // origin + Verified Frame, since the head is about to move and waking needs a
  // soft-reset that clears G92.
  readonly releaseMotors: () => Promise<void>;
  // ADR-053 P2 — record a clean Verified Frame for the current job + origin.
  readonly markFrameVerified: (verification: FrameVerification) => void;
};

type LiveRefs = ControllerLifecycleRefs & {
  connection: SerialConnection | null;
  unsubscribeLine: (() => void) | null;
  unsubscribeClose: (() => void) | null;
  pollHandle: ReturnType<typeof setInterval> | null;
  // F-7: pure state machine collecting the `$$` settings dump. Kept
  // out of the React-observable state because every interim setting
  // line would otherwise re-render Laser components for no reason —
  // only the final `done` patch matters to the UI.
  settingsCollector: SettingsCollectorState;
  onLineArrived: (() => void) | null;
  nextTranscriptId: number;
  // M13 ack-watchdog probe: last-seen stream position + when it was first
  // seen unchanged. Lives here (not React state) — only the poll reads it.
  stallProbe: StallProbe;
};

const refs: LiveRefs = {
  connection: null,
  unsubscribeLine: null,
  unsubscribeClose: null,
  pollHandle: null,
  settingsCollector: idleCollector(),
  onLineArrived: null,
  nextTranscriptId: 1,
  stallProbe: null,
  controllerCommand: null,
  controllerIdleWait: null,
};

function teardown(): void {
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

async function safeWrite(
  set: SetFn,
  get: GetFn,
  line: string,
  action?: Parameters<typeof writeFailedNotice>[0],
  source?: TranscriptSource,
): Promise<void> {
  await createSafeWrite(set, get, refs)(line, action, source);
}

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

function connectionActions(set: SetFn, get: GetFn): Pick<LaserState, 'connect' | 'disconnect'> {
  return {
    connect: async (adapter) => {
      refs.nextTranscriptId = 1;
      set({
        connection: { kind: 'connecting' },
        controllerOperation: null,
        log: [],
        transcript: [],
        homingState: 'unknown',
      });
      const portRef = await adapter.serial.requestPort();
      if (portRef === null) {
        set({ connection: { kind: 'disconnected' } });
        return;
      }
      try {
        const conn = await portRef.open({ baudRate: DEFAULT_BAUD });
        refs.connection = conn;
        refs.unsubscribeLine = conn.onLine((line) =>
          handleLine(set, get, refs, (out) => safeWrite(set, get, out), line),
        );
        refs.unsubscribeClose = conn.onClose(() => {
          teardown();
          set(buildPortClosePatch);
        });
        startStatusPolling(set, get);
        set({
          connection: { kind: 'connected' },
          alarmCode: null,
          lastWriteError: null,
          safetyNotice: null,
          controllerOperation: null,
          homingState: 'unknown',
        });
        void runHandshake(set, get, refs, (out) => safeWrite(set, get, out)).catch(() => undefined);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ connection: { kind: 'failed', error: message } });
      }
    },
    disconnect: async () => {
      assertAutofocusIdle(get());
      const conn = refs.connection;
      const stopCommands = disconnectStopCommands(get());
      if (stopCommands.length > 0) {
        try {
          for (const stopCommand of stopCommands) {
            await safeWrite(set, get, stopCommand, 'disconnect');
          }
        } catch {
          // The stop-before-disconnect write failed (USB likely already gone),
          // so the machine may still run buffered commands. Warn — but STILL
          // tear down the link the operator asked to drop (don't rethrow).
          set({ safetyNotice: writeFailedNotice('disconnect') });
        }
      }
      teardown();
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
        frameVerification: null,
        motionOperation: null,
        controllerOperation: null,
        homingState: 'unknown',
        lastWriteError: null,
      });
    },
  };
}

function startStatusPolling(set: SetFn, get: GetFn): void {
  let pollTick = 0;
  refs.pollHandle = setInterval(() => {
    pollTick++;
    const s = get();
    const stall = detectStreamStall(s.streamer, s.statusReport, refs.stallProbe, Date.now());
    refs.stallProbe = stall.probe;
    if (stall.stalled && s.safetyNotice === null) set({ safetyNotice: streamStalledNotice() });
    if (!shouldFastPoll(s) && pollTick % IDLE_POLL_DIVISOR !== 0) return;
    void safeWrite(set, get, RT_STATUS).catch(() => undefined);
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

function jogActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'home' | 'autofocus' | 'unlockAlarm' | 'jog' | 'cancelJog' | 'frame'> {
  return {
    home: async () => {
      await runHomeAction(set, get, refs, (line, action, source) =>
        safeWrite(set, get, line, action, source),
      );
    },
    autofocus: async (command) => {
      const activeJobBlock = activeJobCommandBlockMessage(get());
      if (activeJobBlock !== null) return { kind: 'preflight-failed', reason: activeJobBlock };
      const motionOperationBlock = motionOperationCommandBlockMessage(get());
      if (motionOperationBlock !== null) {
        return { kind: 'preflight-failed', reason: motionOperationBlock };
      }
      if (get().autofocusBusy) {
        return { kind: 'preflight-failed', reason: 'Auto-focus is already running.' };
      }
      set({ autofocusBusy: true });
      try {
        return await runAutofocus({
          connection: refs.connection,
          statusReport: get().statusReport,
          command,
        });
      } finally {
        set({ autofocusBusy: false });
      }
    },
    unlockAlarm: async () => {
      assertNoMotionOperation(set, get);
      await safeWrite(set, get, `${CMD_UNLOCK}\n`, 'unlock');
      set({ alarmCode: null, homingState: 'unknown' });
    },
    jog: async (params) => {
      assertAutofocusIdle(get());
      assertJogFrameReady(set, get);
      set({ motionOperation: startMotionOperation('jog') });
      try {
        await safeWrite(set, get, `${buildJogCommand(params)}\n`, 'jog');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'jog'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
    cancelJog: () =>
      safeWrite(set, get, RT_JOG_CANCEL, 'jog').finally(() =>
        set({ motionOperation: null, frameVerification: null }),
      ),
    frame: async (bounds, feed) => {
      assertAutofocusIdle(get());
      assertJogFrameReady(set, get);
      const [firstLine, ...pendingLines] = buildFrameJogLines(bounds, feed);
      if (firstLine === undefined) return;
      set({ motionOperation: startMotionOperation('frame', pendingLines) });
      try {
        await safeWrite(set, get, firstLine, 'frame');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'frame'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
  };
}

function assertJogFrameReady(set: SetFn, get: GetFn): void {
  const blockedMessage = jogFrameCommandBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

function assertNoMotionOperation(set: SetFn, get: GetFn): void {
  const blockedMessage = motionOperationCommandBlockMessage(get());
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(get(), `[lf2] Motion command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

function detectedSettingsActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'applyDetectedSettings' | 'dismissDetectedSettings'> {
  return {
    applyDetectedSettings: () => {
      const patch = get().detectedSettings;
      if (!applyDetectedSettingsPatch(patch)) return;
      set({
        detectedSettings: null,
        log: pushLog(get(), '[lf2] Applied detected machine settings to device profile.'),
      });
    },
    dismissDetectedSettings: () => set({ detectedSettings: null }),
  };
}

export const useLaserStore = create<LaserState>((set, get) => ({
  ...initialLaserState(),
  ...connectionActions(set, get),
  ...jogActions(set, get),
  ...jobActions(set, get, (line, action) => safeWrite(set, get, line, action)),
  ...setupActions(set, get, refs, (line) => safeWrite(set, get, line)),
  ...grblSettingsActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  ),
  ...consoleActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  ),
  ...controllerRecoveryActions(set, refs, (line, action) => safeWrite(set, get, line, action)),
  ...originActions(set, get, (line, action) => safeWrite(set, get, line, action)),
  ...detectedSettingsActions(set, get),
  clearSafetyNotice: () => set({ safetyNotice: null }),
  markFrameVerified: (verification) => set({ frameVerification: verification }),
}));
