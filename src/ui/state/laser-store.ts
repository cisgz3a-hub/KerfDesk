// laser-store — Zustand store for the live serial connection to the laser
// controller. Firmware specifics come from the active ControllerDriver
// (ADR-094); this file must not hardcode any protocol bytes.
import { create } from 'zustand';
import {
  type GrblSettingRow,
  idleCollector,
  type SettingsCollectorState,
  type StatusReport,
  type StreamerState,
} from '../../core/controllers/grbl';
import {
  grblDriver,
  type ControllerCapabilities,
  type ControllerDriver,
} from '../../core/controllers';
import type { ActiveWorkCoordinateSystem } from '../../core/controllers/grbl/work-offset-readback';
import type { ControllerKind, DeviceProfile } from '../../core/devices';
import type { ControllerSettingsSnapshot } from '../../core/preflight';
import type { MachineKind } from '../../core/scene';
import type { SerialConnection } from '../../platform/types';
import { runAutofocus } from './autofocus-action';
import { consoleActions } from './laser-console-actions';
import { invalidateAccessoryObservation } from './cnc-accessory-readiness';
import type { LaserControllerOperation } from './laser-controller-operation';
import type {
  ControllerQualification,
  ControllerQualificationScheduleRefs,
} from './laser-controller-qualification';
import { controllerOperationCommandBlockMessage } from './laser-controller-operation';
import { controllerRecoveryActions } from './laser-controller-recovery-actions';
import { applyDetectedSettingsPatch } from './detected-settings-action';
import { grblSettingsActions } from './grbl-settings-actions';
import type { ControllerLifecycleRefs } from './laser-interactive-command';
import { connectionActions } from './laser-connection-actions';
import type { ConnectAttemptOwnershipRefs } from './laser-connect-attempt';
import type { ConnectionTeardownOwnershipRefs } from './laser-connection-teardown';
import { jobActions } from './laser-job-actions';
import { appendSystemNotice } from './laser-system-notice';
import { jogActions } from './laser-jog-actions';
import { type LaserMotionOperation } from './laser-motion-operation';
import { type WorkCoordinateOffset } from './origin-actions';
import { originActions } from './laser-origin-actions';
import type { ResetCleanupRefs } from './laser-reset-cleanup';
import type { ActiveStreamHeartbeatProbe } from './laser-stream-heartbeat';
import { overrideActions } from './override-actions';
import { probeActions } from './laser-probe-actions';
import type { OverrideValues } from '../../core/controllers/grbl';
import { useStore } from './store';
import type { FrameVerification } from './frame-verification';
import type { FramedRunPermit, FramedRunStartClaim } from './framed-run';
import type { WorkZZeroEvidence } from './work-z-zero-evidence';
import type { LiveCanvasRun } from './canvas-motion-plan';
import type {
  ControllerObservationStamp,
  HomingProof,
  SessionObservationStamp,
} from './laser-controller-observation';
import type { LaserSafetyAction, LaserSafetyNotice } from './laser-safety-notice';
import { createSafeWrite, type SafeWrite } from './laser-safe-write';
import { setupActions } from './laser-setup-actions';
import { fireActions } from './laser-fire-actions';
import { type SerialTranscriptEntry, type TranscriptSource } from './laser-transcript';
import { workZRecoveryActions } from './work-z-recovery-actions';
import type { LaserStoreActions } from './laser-store-action-types';
import type { RunId } from './recovery';
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
export type { StartJobOptions } from './laser-job-options';

/** Connect-time controller selection. Omitted fields fall back to the GRBL
 *  driver and its default baud — the only behavior that existed pre-ADR-094. */
export type ConnectionState =
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'connecting' }
  | { readonly kind: 'connected' }
  | { readonly kind: 'failed'; readonly error: string };
export type HomingState = 'unknown' | 'homing' | 'confirmed';
export type WorkOriginSource = 'none' | 'g92' | 'g54-persistent' | 'unknown';

export type { ConnectControllerOptions } from './laser-store-action-types';

export type LaserState = LaserStoreActions & {
  readonly connection: ConnectionState;
  readonly statusReport: StatusReport | null;
  readonly controllerSessionEpoch: number;
  readonly statusSequence: number;
  readonly statusObservation: ControllerObservationStamp | null;
  readonly alarmCode: number | null;
  readonly lastError: number | null;
  readonly lastWriteError: string | null;
  // Operator-requested coolant/air state for the manual jog-panel control.
  // Jobs may still emit their own M7/M8/M9 sequence; Stop/Disconnect force this
  // false after sending the driver's coolant-off cleanup.
  readonly airAssistOn: boolean;
  // True while a guarded momentary Fire request is active, including its
  // in-flight serial write. Every exit path clears this before the final M5.
  readonly fireActive: boolean;
  // P0-B: operator-facing safety alert raised when the store cannot guarantee
  // the machine is safe — a failed Stop/Pause/Resume/Disconnect write, or a USB
  // drop mid-job. null = nothing to warn about. Reconnect preserves the notice;
  // only explicit operator acknowledgment via clearSafetyNotice clears it.
  readonly safetyNotice: LaserSafetyNotice | null;
  readonly autofocusBusy: boolean;
  // ADR-103 G2 - a touch-plate probe cycle is mid-flight.
  readonly probeBusy: boolean;
  readonly motionOperation: LaserMotionOperation | null;
  readonly controllerOperation: LaserControllerOperation | null;
  readonly streamer: StreamerState | null;
  /** Immutable recovery/replay ownership for the current streamer. */
  readonly activeRunId: RunId | null;
  /** Controller-reported canvas truth for the active or most recently
   * completed run. The started plan is immutable for the life of the run. */
  readonly liveCanvasRun?: LiveCanvasRun | null;
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
  // Writes whose transport promise has not resolved yet. Reserved before
  // awaiting conn.write so Start cannot install an ack-correlated fence while
  // an earlier command is accepted by the controller but absent from the ack ledger.
  readonly pendingTransportWrites?: number;
  readonly homingState: HomingState;
  readonly homingProof: HomingProof | null;
  readonly trustedPositionEpoch?: number;
  readonly workZReferenceEpoch: number;
  readonly log: ReadonlyArray<string>;
  readonly transcript: ReadonlyArray<SerialTranscriptEntry>;
  // F-7: settings auto-detected from the `$$` dump on connect. Non-null
  // means "the user hasn't responded to the detection banner yet" —
  // null after either Apply (which dispatched updateDeviceProfile) or
  // Dismiss (which left the profile alone).
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly controllerSettings: ControllerSettingsSnapshot | null;
  readonly controllerSettingsObservation: SessionObservationStamp | null;
  /** Qualification of the live controller session. Every record is bound to
   * controllerSessionEpoch so late replies from a reset or forgotten port can
   * never make a newer session look ready. */
  readonly controllerQualification: ControllerQualification;
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
  // The work coordinate system the operator has selected via the console
  // (G54-G59). Null = never selected one this session (KerfDesk's own flows
  // always run in G54). GRBL status frames never report which WCS is active,
  // only the active WCS's offset, so this is tracked from console commands;
  // job/save advisories warn when it is non-G54 because emission pins G54 while
  // placement is computed from the active offset (audit C6). Not populated for
  // $N startup blocks or external-session selections — those need a $G readback.
  readonly activeWcs: ActiveWorkCoordinateSystem | null;
  // ADR-103 G3 - last-seen Ov: feed/rapid/spindle override percentages,
  // cached across frames exactly like wcoCache.
  readonly ovCache: OverrideValues | null;
  // ADR-179 - last controller-commanded spindle/coolant state observed via
  // GRBL A:. Optional only so older hand-built test states remain valid.
  // null/undefined means unknown, not known off.
  readonly accessoryCache?: NonNullable<StatusReport['accessories']> | null;
  // Explicit grblHAL MPG:1/0 ownership evidence. Latches across status frames
  // that omit the intermittent field; null/undefined means never observed in
  // this controller/transport session.
  readonly mpgActive?: boolean | null;
  readonly workOriginActive: boolean;
  readonly workOriginSource: WorkOriginSource;
  // Monotonic identity for XY work-origin mutations. Place Board registration
  // binds to this so a later G92/G92.1/G10 cannot silently reuse stale targets.
  readonly workOriginVersion?: number;
  // Qualified evidence for the CNC stock-top contract. Separate from
  // workOriginActive (XY origin): Set Origin (G92 X0 Y0) does not establish Z.
  // The record is bound to workZReferenceEpoch so reconnect/reset/home and
  // other reference-loss events make stale evidence fail closed at Start.
  readonly workZZeroEvidence: WorkZZeroEvidence | null;
  // Tool-change readiness: true only once a FRESH Idle status report has been
  // observed since the streamer entered the tool-change hold (cleared on entry,
  // set when Idle arrives with the pre-M0 tail drained). Guards the setup gate
  // and Continue against a STALE Idle from before Start, so jog/probe/Continue
  // cannot unlock while the pre-change retract/park is still moving (Codex audit
  // P1).
  readonly toolChangeIdleSeen: boolean;
  // The next-bit labels remaining in the current CNC job, in stream order (R5).
  // Set at Start from the compiled program's tool-change comments; the head is
  // consumed into pendingToolLabel each time a tool-change hold is entered.
  readonly toolChangeLabels: ReadonlyArray<string>;
  // Stable IDs parallel to toolChangeLabels. null preserves the legacy/imported
  // fallback where only a comment label is available.
  readonly toolChangeToolIds: ReadonlyArray<string | null>;
  // The bit to load at the CURRENT tool-change hold, or null when it is unknown
  // (single-tool job, imported .nc, resume tail) — the UI names the bit when set
  // and falls back to a generic prompt when null (R5).
  readonly pendingToolLabel: string | null;
  readonly pendingToolId: string | null;
  /**
   * Compatibility proof issued only after a clean Frame completion. Ordinary
   * Start uses the exact `framedRun` permit below; this bounds/origin proof is
   * retained for recovery and completed-job replay compatibility. Physical or
   * setup mutations clear it, while project changes invalidate it structurally
   * when the bounds signature no longer matches. null = not verified.
   */
  readonly frameVerification: FrameVerification | null;
  /** Exact reviewed program authorized only after its Frame physically
   * completes. A pending Frame candidate lives on motionOperation instead. */
  readonly framedRun: FramedRunPermit | null;
  /** Atomic owner while ordinary Start hands one exact permit to the store. */
  readonly framedRunStartClaim: FramedRunStartClaim | null;
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
  settingsCollectorSessionEpoch: number | null;
  onLineArrived: (() => void) | null;
  nextTranscriptId: number;
  // M13 ack-watchdog probe: last-seen stream position + when it was first
  // seen unchanged. Lives here (not React state) — only the poll reads it.
  stallProbe: StallProbe;
} & ResetCleanupRefs &
  ConnectAttemptOwnershipRefs &
  ConnectionTeardownOwnershipRefs &
  ControllerQualificationScheduleRefs & {
    // Fail-dark transport heartbeat for active/physically-finishing streams.
    // Status sequence ownership is session-scoped; teardown always clears it.
    heartbeatProbe: ActiveStreamHeartbeatProbe;
    /** Store-local Forget finalization ownership. A module-global WeakMap can
     * couple independent store instances that happen to share a test port. */
    forgetFinalizations: WeakMap<SerialConnection, Promise<void>>;
  };

const refs: LiveRefs = {
  connection: null,
  driver: grblDriver,
  unsubscribeLine: null,
  unsubscribeClose: null,
  pollHandle: null,
  settingsCollector: idleCollector(),
  settingsCollectorSessionEpoch: null,
  onLineArrived: null,
  nextTranscriptId: 1,
  stallProbe: null,
  qualificationTimer: null,
  qualificationDeadline: null,
  runControllerQualification: null,
  heartbeatProbe: null,
  connectAttemptRevision: 0,
  forgetIntentRevision: 0,
  closeRequests: new WeakMap(),
  intentionalDisconnects: new WeakMap(),
  forgetFinalizations: new WeakMap(),
  controllerCommand: null,
  controllerIdleWait: null,
  controllerResetWait: null,
  controllerStatusWait: null,
  pauseResumeTransition: null,
  writeEpoch: 0,
  pendingResetCleanup: null,
  untrackedAckReservations: [],
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
  refs: LiveRefs,
  write: SafeWrite,
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
      const state = get();
      if (
        state.pendingUntrackedAcks > 0 ||
        (state.pendingTransportWrites ?? 0) > 0 ||
        refs.controllerCommand !== null ||
        refs.controllerIdleWait !== null
      ) {
        return {
          kind: 'preflight-failed',
          reason: 'Wait for the previous controller command to finish before auto-focusing.',
        };
      }
      // Auto-focus/probe is physical machine activity after Frame. Expire the
      // one-run permit before the vendor command can move or refocus anything;
      // returning to the same reported coordinates must not resurrect it.
      set({ autofocusBusy: true, framedRun: null, frameVerification: null });
      try {
        return await runAutofocus({
          connected: refs.connection !== null,
          statusReport: get().statusReport,
          command,
          refs,
          write,
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
      // Clear before the serial write yields so a concurrent Start cannot
      // trust the previous accessory observation after M7/M8/M9 was sent.
      set((state) => ({
        accessoryCache: invalidateAccessoryObservation(state.accessoryCache),
      }));
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

export const useLaserStore = create<LaserState>((set, get) => {
  const settingsActions = grblSettingsActions(set, get, refs, (line, action, source) =>
    safeWrite(set, get, line, action, source),
  );
  refs.runControllerQualification = settingsActions.readMachineSettings;
  return {
    ...initialLaserState(),
    ...connectionActions(set, get, refs, (line, action, source) =>
      safeWrite(set, get, line, action, source),
    ),
    ...autofocusActions(set, get, refs, (line, action, source) =>
      safeWrite(set, get, line, action, source),
    ),
    ...jogActions(set, get, refs, (line, action, source) =>
      safeWrite(set, get, line, action, source),
    ),
    ...airAssistActions(set, get),
    ...fireActions(set, get, (line, action, source) => safeWrite(set, get, line, action, source)),
    ...probeActions(set, get, refs, (line, action, source) =>
      safeWrite(set, get, line, action, source),
    ),
    ...overrideActions(
      (line) => safeWrite(set, get, line),
      () => get().capabilities.overrides,
      () =>
        get().controllerOperation?.kind === 'probe'
          ? 'Realtime overrides are locked during a probe transaction.'
          : null,
    ),
    ...jobActions(
      set,
      get,
      refs,
      (line, action) => safeWrite(set, get, line, action),
      () => refs.driver,
    ),
    ...setupActions(set, get, refs, (line) => safeWrite(set, get, line)),
    ...settingsActions,
    retryControllerQualification: settingsActions.readMachineSettings,
    ...consoleActions(set, get, refs, (line, action, source) =>
      safeWrite(set, get, line, action, source),
    ),
    ...controllerRecoveryActions(
      set,
      get,
      refs,
      (line, action) => safeWrite(set, get, line, action),
      () => refs.driver,
    ),
    ...originActions(set, get, refs, (line, action, source) =>
      safeWrite(set, get, line, action, source),
    ),
    ...workZRecoveryActions(
      set,
      get,
      refs,
      (line) => safeWrite(set, get, line),
      () => refs.driver,
    ),
    ...detectedSettingsActions(set, get),
    clearSafetyNotice: () => set({ safetyNotice: null }),
    pushSystemNotice: (line) => set(appendSystemNotice(get(), refs, line)),
  };
});
