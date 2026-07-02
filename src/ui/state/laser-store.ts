// laser-store — Zustand store for the live serial connection to the laser
// controller. Firmware specifics come from the active ControllerDriver
// (ADR-094); this file must not hardcode any protocol bytes.
import { create } from 'zustand';
import {
  type GrblSettingRow,
  idleCollector,
  type JogParams,
  type SettingsCollectorState,
  type StatusReport,
  type StreamerState,
  type CreateStreamerOptions,
} from '../../core/controllers/grbl';
import {
  grblDriver,
  type ControllerCapabilities,
  type ControllerDriver,
} from '../../core/controllers';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { type AutofocusResult, runAutofocus } from './autofocus-action';
import { consoleActions, type ConsoleCommandOptions } from './laser-console-actions';
import type { LaserControllerOperation } from './laser-controller-operation';
import { controllerRecoveryActions } from './laser-controller-recovery-actions';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { grblSettingsActions } from './grbl-settings-actions';
import { runHomeAction } from './laser-home-action';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { connectionActions } from './laser-connection-actions';
import { jobActions } from './laser-job-actions';
import {
  markMotionOperationDispatched,
  startMotionOperation,
  type LaserMotionOperation,
} from './laser-motion-operation';
import { type WorkCoordinateOffset } from './origin-actions';
import { originActions } from './laser-origin-actions';
import type { FrameVerification } from './frame-verification';
import type { LaserSafetyAction, LaserSafetyNotice } from './laser-safety-notice';
import { createSafeWrite } from './laser-safe-write';
import { setupActions } from './laser-setup-actions';
import { type SerialTranscriptEntry, type TranscriptSource } from './laser-transcript';
import {
  activeJobCommandBlockMessage,
  assertAutofocusIdle,
  initialLaserState,
  jogFrameCommandBlockMessage,
  motionOperationCommandBlockMessage,
  pushLog,
  type StallProbe,
} from './laser-store-helpers';

export { describeAutofocusResult, type AutofocusResult } from './autofocus-action';
export { hasCustomOrigin, type WorkCoordinateOffset } from './origin-actions';

/** Connect-time controller selection. Omitted fields fall back to the GRBL
 *  driver and its default baud — the only behavior that existed pre-ADR-094. */
export type ConnectControllerOptions = {
  readonly controllerKind?: ControllerKind | undefined;
  readonly baudRate?: number | undefined;
};

export type ConnectionState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | { readonly kind: 'failed'; readonly error: string };
export type HomingState = 'unknown' | 'homing' | 'confirmed';
export type WorkOriginSource = 'none' | 'g92' | 'g54-persistent' | 'unknown';

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
  readonly workOriginSource: WorkOriginSource;
  /**
   * ADR-053 P2 — proof that a clean Verified Frame ran for the current job at
   * the current origin. Set when a frame is dispatched in 'verified-origin'
   * mode; required by Start in that mode. Cleared whenever the origin or
   * connection changes (set/reset origin, disconnect, port close) or a frame is
   * cancelled, and invalidated structurally when the job moves/resizes (the
   * bounds signature stops matching). null = not verified.
   */
  readonly frameVerification: FrameVerification | null;
  /**
   * ADR-094 — capabilities snapshot of the active ControllerDriver. UI
   * components gate controls on these flags, never on the controller kind.
   * Defaults to GRBL's (all-enabled) capabilities while disconnected so the
   * panel renders identically to the pre-driver app.
   */
  readonly capabilities: ControllerCapabilities;

  readonly connect: (adapter: PlatformAdapter, options?: ConnectControllerOptions) => Promise<void>;
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
  readonly startJob: (gcode: string, options?: CreateStreamerOptions) => Promise<void>;
  readonly pauseJob: () => Promise<void>;
  readonly resumeJob: () => Promise<void>;
  readonly stopJob: () => Promise<void>;
  readonly clearSafetyNotice: () => void;
  readonly applyDetectedSettings: () => void;
  readonly dismissDetectedSettings: () => void;
  // G92 is the default session-scoped origin; advanced controls use G10/G54.
  readonly setOriginHere: () => Promise<void>;
  readonly resetOrigin: () => Promise<void>;
  readonly setPersistentOriginHere: () => Promise<void>;
  readonly clearPersistentOrigin: () => Promise<void>;
  // ADR-053 P4 — $SLP to release the steppers for hand-positioning. Drops the
  // origin + Verified Frame, since the head is about to move and waking needs a
  // soft-reset that clears G92.
  readonly releaseMotors: () => Promise<void>;
  // ADR-053 P2 — record a clean Verified Frame for the current job + origin.
  readonly markFrameVerified: (verification: FrameVerification) => void;
};

export type LiveRefs = ControllerLifecycleRefs & {
  connection: SerialConnection | null;
  // The active firmware driver. Selected at connect time from the device
  // profile's controllerKind; GRBL when disconnected (pre-ADR-094 behavior).
  driver: ControllerDriver;
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
  driver: grblDriver,
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

async function safeWrite(
  set: SetFn,
  get: GetFn,
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
): Promise<void> {
  await createSafeWrite(set, get, refs)(line, action, source);
}

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

function autofocusActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'autofocus' | 'unlockAlarm'> {
  return {
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
      const unlock = refs.driver.commands.unlock;
      if (unlock === null) throw new Error('This controller has no unlock command.');
      await safeWrite(set, get, `${unlock}\n`, 'unlock');
      set({ alarmCode: null, homingState: 'unknown' });
    },
  };
}

function jogActions(
  set: SetFn,
  get: GetFn,
): Pick<LaserState, 'home' | 'jog' | 'cancelJog' | 'frame'> {
  return {
    home: async () => {
      await runHomeAction(
        set,
        get,
        refs,
        (line, action, source) => safeWrite(set, get, line, action, source),
        refs.driver,
      );
    },
    jog: async (params) => {
      assertAutofocusIdle(get());
      assertJogFrameReady(set, get);
      set({ motionOperation: startMotionOperation('jog') });
      try {
        await safeWrite(set, get, `${refs.driver.commands.buildJog(params)}\n`, 'jog');
        set((s) => ({
          motionOperation: markMotionOperationDispatched(s.motionOperation, 'jog'),
        }));
      } catch (err) {
        set({ motionOperation: null });
        throw err;
      }
    },
    cancelJog: async () => {
      const jogCancel = refs.driver.realtime.jogCancel;
      if (jogCancel === null) {
        set({ motionOperation: null, frameVerification: null });
        return;
      }
      await safeWrite(set, get, jogCancel, 'jog').finally(() =>
        set({ motionOperation: null, frameVerification: null }),
      );
    },
    frame: async (bounds, feed) => {
      assertAutofocusIdle(get());
      assertJogFrameReady(set, get);
      const [firstLine, ...pendingLines] = refs.driver.commands.buildFrameLines(bounds, feed);
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
  ...connectionActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  ),
  ...autofocusActions(set, get),
  ...jogActions(set, get),
  ...jobActions(
    set,
    get,
    (line, action) => safeWrite(set, get, line, action),
    () => refs.driver,
  ),
  ...setupActions(set, get, refs, (line) => safeWrite(set, get, line)),
  ...grblSettingsActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  ),
  ...consoleActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  ),
  ...controllerRecoveryActions(
    set,
    refs,
    (line, action) => safeWrite(set, get, line, action),
    () => refs.driver,
  ),
  ...originActions(set, get, (line, action) => safeWrite(set, get, line, action)),
  ...detectedSettingsActions(set, get),
  clearSafetyNotice: () => set({ safetyNotice: null }),
  markFrameVerified: (verification) => set({ frameVerification: verification }),
}));
