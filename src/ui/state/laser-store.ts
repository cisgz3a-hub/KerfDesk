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
import type { MachineKind } from '../../core/scene';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { type AutofocusResult, runAutofocus } from './autofocus-action';
import { consoleActions, type ConsoleCommandOptions } from './laser-console-actions';
import type { LaserControllerOperation } from './laser-controller-operation';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { controllerRecoveryActions } from './laser-controller-recovery-actions';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { grblSettingsActions } from './grbl-settings-actions';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { connectionActions } from './laser-connection-actions';
import { jobActions } from './laser-job-actions';
import { jogActions } from './laser-jog-actions';
import { type LaserMotionOperation } from './laser-motion-operation';
import { type WorkCoordinateOffset } from './origin-actions';
import { originActions } from './laser-origin-actions';
import type { ResetCleanupRefs } from './laser-reset-cleanup';
import { overrideActions } from './override-actions';
import { probeActions } from './laser-probe-actions';
import type { ProbeResult } from './probe-actions';
import type { OverrideValues, RealtimeOverrideByte } from '../../core/controllers/grbl';
import { useStore } from './store';
import type { FrameVerification } from './frame-verification';
import type { LaserSafetyAction, LaserSafetyNotice } from './laser-safety-notice';
import { createSafeWrite } from './laser-safe-write';
import { setupActions } from './laser-setup-actions';
import { type SerialTranscriptEntry, type TranscriptSource } from './laser-transcript';
import {
  activeJobCommandBlockMessage,
  assertAutofocusIdle,
  initialLaserState,
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

// Streamer options plus the machine kind the job was compiled for, so pause
// safety can distinguish laser ($32 proof required) from router (must not).
export type StartJobOptions = CreateStreamerOptions & {
  readonly machineKind?: MachineKind;
};

export type LaserState = {
  readonly connection: ConnectionState;
  readonly statusReport: StatusReport | null;
  readonly alarmCode: number | null;
  readonly lastError: number | null;
  readonly lastWriteError: string | null;
  // Operator-requested coolant/air state for the manual jog-panel control.
  // Jobs may still emit their own M7/M8/M9 sequence; Stop/Disconnect force this
  // false after sending the driver's coolant-off cleanup.
  readonly airAssistOn: boolean;
  // P0-B: operator-facing safety alert raised when the store cannot guarantee
  // the machine is safe — a failed Stop/Pause/Resume/Disconnect write, or a USB
  // drop mid-job. null = nothing to warn about. Cleared on the next successful
  // connect or via clearSafetyNotice.
  readonly safetyNotice: LaserSafetyNotice | null;
  readonly autofocusBusy: boolean;
  // ADR-103 G2 - a touch-plate probe cycle is mid-flight.
  readonly probeBusy: boolean;
  readonly motionOperation: LaserMotionOperation | null;
  readonly controllerOperation: LaserControllerOperation | null;
  readonly streamer: StreamerState | null;
  // Which machine kind the running job was compiled for. Pause safety
  // differs by kind: lasers need the $32=1 proof before feed hold (the beam
  // can stay on through a hold at $32=0); routers require $32=0 and hold is
  // safe with the spindle spinning. null = no job started yet.
  readonly activeJobMachineKind: MachineKind | null;
  // Queued writes outside the job stream (console, origin, unlock, the
  // handshake $$ …) that still owe a terminal ok/error. GRBL acks in strict
  // receive order, so Start must wait for 0: a stale ok mis-attributed to a
  // fresh job stream frees RX budget GRBL has not freed, and the phantom
  // refill can overflow the real 128-byte buffer mid-burn.
  readonly pendingUntrackedAcks: number;
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
  // ADR-103 G3 - last-seen Ov: feed/rapid/spindle override percentages,
  // cached across frames exactly like wcoCache.
  readonly ovCache: OverrideValues | null;
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
  /** Kind of the ACTIVE driver (selected at connect). Components use this for
   *  pure driver-data lookups (console quick commands); guards still gate on
   *  `capabilities`, never on the kind. */
  readonly activeControllerKind: ControllerKind;
  /** Firmware family detected from the welcome banner, null until seen. May
   *  disagree with the profile-selected driver (advisory — see line handler). */
  readonly detectedControllerKind: ControllerKind | null;

  readonly connect: (adapter: PlatformAdapter, options?: ConnectControllerOptions) => Promise<void>;
  readonly disconnect: () => Promise<void>;
  readonly home: () => Promise<void>;
  readonly autofocus: (command: string) => Promise<AutofocusResult>;
  // ADR-103 G2 - run a prepared touch-plate probing sequence.
  readonly probe: (lines: ReadonlyArray<string>) => Promise<ProbeResult>;
  // ADR-103 G3 - send a real-time override byte (legal mid-job by design).
  readonly sendRealtimeOverride: (byte: RealtimeOverrideByte) => Promise<void>;
  readonly unlockAlarm: () => Promise<void>;
  readonly wakeController: () => Promise<void>;
  readonly configureGrblLaserSetup: () => Promise<void>;
  readonly readMachineSettings: () => Promise<void>;
  readonly writeGrblSetting: (id: number, value: string) => Promise<void>;
  readonly sendConsoleCommand: (command: string, options?: ConsoleCommandOptions) => Promise<void>;
  readonly clearTranscript: () => void;
  readonly jog: (params: JogParams) => Promise<void>;
  // ADR-124 — jog the head to a captured board point (a corner or the centre),
  // given as a machine coordinate. Computed as a relative delta from the current
  // machine position so it reuses `jog`'s guards and works for the (0,0) corner.
  readonly jogToMachinePosition: (x: number, y: number, feed: number) => Promise<void>;
  readonly setAirAssistEnabled: (enabled: boolean) => Promise<void>;
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
  readonly startJob: (gcode: string, options?: StartJobOptions) => Promise<void>;
  readonly pauseJob: () => Promise<void>;
  readonly resumeJob: () => Promise<void>;
  readonly stopJob: () => Promise<void>;
  readonly clearSafetyNotice: () => void;
  readonly applyDetectedSettings: () => void;
  readonly dismissDetectedSettings: () => void;
  // G92 is the default session-scoped origin; advanced controls use G10/G54.
  readonly setOriginHere: () => Promise<void>;
  // CNC stock-top zeroing: G92 Z0 at the current bit height. XY untouched.
  readonly zeroZHere: () => Promise<void>;
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
} & ResetCleanupRefs;

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
  pendingResetCleanup: null,
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

function autofocusActions(set: SetFn, get: GetFn): Pick<LaserState, 'autofocus' | 'unlockAlarm'> {
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

function airAssistActions(set: SetFn, get: GetFn): Pick<LaserState, 'setAirAssistEnabled'> {
  return {
    setAirAssistEnabled: async (enabled) => {
      assertAutofocusIdle(get());
      assertAirAssistReady(set, get);
      const command = enabled ? useStore.getState().project.device.airAssistCommand : 'M9';
      if (command === 'none') {
        const message =
          'Manual air is disabled because Device Profile > Air output is Disabled. Set it to M7 or M8 first.';
        set({
          lastWriteError: message,
          log: pushLog(get(), `[lf2] Manual air command blocked: ${message}`),
        });
        throw new Error(message);
      }
      await safeWrite(set, get, `${command}\n`, 'air-assist', 'console');
      set({
        airAssistOn: enabled,
        lastWriteError: null,
        log: pushLog(get(), `[lf2] Manual air ${enabled ? `on (${command})` : 'off (M9)'}.`),
      });
    },
  };
}

function assertAirAssistReady(set: SetFn, get: GetFn): void {
  const state = get();
  const blockedMessage =
    airAssistCommandBlockMessage(state) ??
    controllerOperationCommandBlockMessage(state.controllerOperation);
  if (blockedMessage === null) return;
  set({
    lastWriteError: blockedMessage,
    log: pushLog(state, `[lf2] Manual air command blocked: ${blockedMessage}`),
  });
  throw new Error(blockedMessage);
}

function airAssistCommandBlockMessage(state: LaserState): string | null {
  const activeJobMessage = activeJobCommandBlockMessage(state);
  if (activeJobMessage !== null) return activeJobMessage;
  const motionOperationMessage = motionOperationCommandBlockMessage(state);
  if (motionOperationMessage !== null) return motionOperationMessage;
  if (state.connection.kind !== 'connected') return 'Connect to the laser first.';
  if (state.statusReport === null) {
    return 'Controller status is not known yet. Wait for an Idle status report before toggling manual air.';
  }
  if (state.statusReport.state !== 'Idle') {
    return `Machine must be Idle before toggling manual air (currently ${state.statusReport.state}).`;
  }
  return null;
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
  ...jogActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  ),
  ...airAssistActions(set, get),
  ...probeActions(set, get, refs),
  ...overrideActions((line) => safeWrite(set, get, line)),
  ...jobActions(
    set,
    get,
    refs,
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
