import { type MutableRefObject } from 'react';
import { type LaserController } from '../controllers/ControllerInterface';
import { type SerialPortLike } from '../communication/SerialPort';
import { WebSerialPort } from '../communication/WebSerialPort';
import { createSerialPort } from '../communication/SerialPortFactory';
import { type MachineState, type JobProgress } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
import { type GcodeStartMode } from '../core/output/GcodeOrigin';
import { type OutputFormat } from '../core/output/Output';
// T1-88: requireFeature import removed — the only consumer was the
// job_replay capture gate, which is now always-on.
import {
  createReplay,
  addReplayEntry,
  finalizeReplay,
  saveReplay,
  type JobReplay,
} from '../core/replay/JobReplay';
import {
  createJobLog,
  addLogEntry,
  finalizeLog,
  saveJobLog,
  type JobLog,
} from '../core/job/JobLog';
import { recordMaterialOutcome } from '../core/materials/MaterialFeedback';
import { estimateJobTime } from '../core/output/TimeEstimator';
import {
  type SafetyActionResult,
  makeNotConnectedResult,
  makeDisconnectResult,
  makeEmergencyStopResult,
  makePauseResult,
  makeResumeResult,
  makeSoftResetStopResult,
} from './SafetyActionResult';
import {
  safetyStateInitial,
  transitionFromSafetyResult,
  type SafetyResultLike,
  type SafetyState,
} from './SafetyStateMachine';
import {
  ackInspection,
  ackUnlock,
  ackRehome,
  ackReframe,
  ackReconnect,
  ackRecompile,
  recoveryStateInitial,
  recoveryAllowsStart,
  triggerAlarm,
  triggerEmergencyStop,
  type RecoveryState,
} from '../runtime/RecoveryState';
// T1-219 (v30 audit #4): token gate for recovery-bypass paths.
import {
  isUnsafeRecoveryBypassToken,
  type UnsafeRecoveryBypassToken,
} from './RecoveryBypassToken';
import {
  classifyConnectionTrust,
  evaluateWiFiActionPolicy,
  type ConnectionKind,
  type FalconWiFiAction,
  type TrustClassification,
} from '../security/FalconWiFiTrust';
import { getActiveProfile } from '../core/devices/DeviceProfile';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { type ActiveJobCanvasContext } from './ActiveJobCanvasContext';
import { setUnsafePriorState, clearUnsafePriorState } from './unsafePriorState';
// T1-195 (extends T1-193): append every safety-relevant event to the
// shared MachineEventLedger so support bundles can reconstruct what
// happened. Pre-T1-195 these events surfaced only via console.warn.
import { getMachineEventLedger } from './MachineEventLedger';
// T1-135: ticket validation extracted to a pure helper so each gate
// (scene/profile/controller/gcode hash) can be tested in isolation.
// Hashing imports + the ControllerId type moved with the logic.
import { validateJobTicket } from './validateJobTicket';
import { buildPipelineJobFingerprint } from './PipelineService';
// T1-136: approval-nonce eviction extracted so the TTL + FIFO rules
// can be unit-tested without mounting the service.
import {
  DEFAULT_MAX_CONSUMED_APPROVAL_NONCES,
  pruneApprovalNonceStore,
} from './approvalNonceStore';
// T1-145: misc pure helpers (G10/G92 detection, safety-result
// translation, structural state equality, nonce factory, burn-state
// factory) moved to a sibling module for independent testability.
// T1-155: controllerDisconnectStopsJob also moved there.
import {
  controllerDisconnectStopsJob,
  createApprovalNonce,
  emptyBurnState,
  mutatesWorkCoordinateSystem,
  safetyResultForStateMachine,
  safetyStatesEqual,
  type DisconnectStopsJobValue,
} from './machineServiceHelpers';
import {
  classifyUserCommand,
  MachineCommandGateway,
  type ApprovalToken,
  type CommandClassification,
  type CommandSeverity,
} from './MachineCommandGateway';
import {
  formatStructuredLogEventForLegacy,
  legacyMessageToStructuredLogEvent,
  normalizeStructuredLogEvent,
  type StructuredLogEvent,
  type StructuredLogEventInput,
} from './StructuredMessageLog';

export interface BurnState {
  readonly activeIds: ReadonlySet<string>;
  readonly burnedIds: ReadonlySet<string>;
}

export type BurnStateListener = (state: BurnState) => void;

/**
 * T2-12 part 1: laser-output safety state union, exported for the
 * subscription contract. T1-22 introduced the underlying state field;
 * T2-12 promotes it to a subscribe-able value.
 */
export type LaserOutputState = 'off' | 'on' | 'unknown';
export type LaserOutputStateListener = (state: LaserOutputState) => void;
export type SafetyStateListener = (state: SafetyState) => void;
export type RecoveryStateListener = (state: RecoveryState) => void;
/**
 * T1-123: ephemeral override that lets safety-critical actions
 * proceed over an untrusted (WiFi) connection. Records the reason
 * the user supplied at override time + an expiry deadline; UI clears
 * + reissues per use case (typical: 5 min). The override does NOT
 * upgrade trust — `getConnectionTrust()` still reports 'untrusted';
 * the override only affects policy evaluation.
 */
export interface WiFiOverride {
  readonly reason: string;
  readonly grantedAt: number;
  readonly expiresAt: number;
}
export type WiFiOverrideListener = (override: WiFiOverride | null) => void;

/**
 * T2-11: kinds of temporary machine operations protected by the
 * service-layer mutex. Each value names a distinct entry point in
 * {@link ExecutionCoordinator}; the mutex prevents two of these
 * from overlapping. The streaming-job state is NOT in this enum —
 * GrblController's `_isJobRunning` already gates manual sendCommand
 * during a streaming job, and the operation mutex is the layer above
 * it that gates the temporary-laser-on operations against each other.
 */
export type ActiveOperationKind =
  | 'jog'
  | 'frame'
  | 'frameDot'
  | 'testFire'
  | 'autoFocus'
  | 'setOrigin';

// T1-155: DisconnectStopsJobValue + controllerDisconnectStopsJob
// moved to ./machineServiceHelpers. The local
// DisconnectSafetyAwareController interface stays because
// _guardDisconnectStopsJob uses its `safetyOps.abortJob` field
// directly — adding it to the helper's interface would couple the
// helper module to non-resolver concerns.
type DisconnectSafetyAwareController = LaserController & {
  capabilities?: {
    safety?: {
      disconnectStopsJob?: DisconnectStopsJobValue;
    };
  };
  safetyOps?: {
    abortJob?: (urgency: 'urgent') => Promise<SafetyActionResult>;
  };
};

/**
 * T2-11: snapshot of the active operation. `null` means no operation is
 * currently held; T1-30's gate map will read this via
 * {@link MachineService.getActiveOperation} as the `opState === 'none'`
 * source. `sessionId` is a monotonically increasing counter so callers
 * can detect "operation was released and re-acquired" across awaits.
 */
export interface ActiveOperationState {
  kind: ActiveOperationKind;
  startedAt: number;
  sessionId: number;
}

/**
 * T1-222 (v30 audit #9, lease tokens): handle returned by
 * {@link MachineService.tryAcquireOperation} and required by
 * {@link MachineService.releaseOperation}. Pre-T1-222 release was
 * keyed only on `kind`, which let a caller from a stale operation
 * round release the mutex held by a fresh round of the SAME kind
 * (e.g. test-fire deadman fires its release `.finally` after the
 * user has already called `endTestFire` AND started a new
 * `beginTestFire`). The lease pairs `kind` with the `sessionId` so
 * a stale release becomes a silent no-op instead of corrupting the
 * current session.
 *
 * Lease objects are immutable value handles — equality is by
 * (`kind`, `sessionId`). Same-kind re-acquire returns a fresh
 * lease that points at the SAME `sessionId` (the re-entry policy
 * is unchanged), so either lease can release the operation.
 */
export interface OperationLease {
  readonly kind: ActiveOperationKind;
  readonly sessionId: number;
}

// T1-145: emptyBurnState moved to ./machineServiceHelpers.

export interface MachineServiceState {
  isSimulator: boolean;
  messages: string[];
  messageEvents: StructuredLogEvent[];
}

export interface JobRecordingSink {
  appendConsoleLine: (line: string) => void;
  onReplayCompleted: (replay: JobReplay) => void;
}

const APPROVAL_TOKEN_TTL_MS = 30_000;
// T1-136: re-export from the helper module so a single source of
// truth pins the cap. Local alias kept for readability at the call
// site that initializes the Map's expected hard-cap.
const MAX_CONSUMED_APPROVAL_NONCES = DEFAULT_MAX_CONSUMED_APPROVAL_NONCES;

// T1-145: mutatesWorkCoordinateSystem / safetyResultForStateMachine /
// safetyStatesEqual / createApprovalNonce moved to ./machineServiceHelpers.

export class MachineService {
  private state: MachineServiceState = {
    isSimulator: false,
    messages: [],
    messageEvents: [],
  };

  private burnState: BurnState = emptyBurnState();
  private burnStateListeners = new Set<BurnStateListener>();

  private activeReplay: JobReplay | null = null;
  private currentJobLog: JobLog | null = null;
  private consumedApprovalNonces = new Map<string, number>();

  /** Ticket currently driving the running job, if any. Set by
   *  startValidatedJob; cleared by tryFinalizeJobLog when the job
   *  ends. Used by phase 5 to enforce scene/profile hash matching
   *  at send time. */
  private activeTicket: ValidatedJobTicket | null = null;

  /**
   * Canvas/head display snapshot (same compile as the ticket), cleared
   * whenever `activeTicket` is cleared. Reference-stable for the life of
   * the run — T1-11; not on ValidatedJobTicket to avoid React identity churn.
   */
  private activeJobCanvasContext: ActiveJobCanvasContext | null = null;

  /** True after we've observed the controller report a running job. Prevents
   *  tryFinalizeJobLog from treating a brand-new `currentJobLog` as
   *  "already finished" when a stale React closure still has idle+!running. */
  private jobObservedRunning = false;
  private nextJobSessionId = 1;
  private activeJobSessionId: number | null = null;

  private detachRecording: (() => void) | null = null;
  /**
   * Conservative tracking of laser output state for job-start gating. T1-22.
   *
   * Driven by:
   * - {@link notifyTestFire} — UI/coordinator tells us when the laser-on
   *   handheld path is engaged.
   * - {@link notifyLaserSafetyOutcome} — coordinator reports the outcome of
   *   {@link LaserController.safetyOff}: an `m5` outcome → `'off'`, anything
   *   else → `'unknown'` (M5 path was indeterminate or both paths failed).
   * - Connect → reset to `'off'` (fresh connection clears stale unknown state).
   *
   * `'unknown'` blocks {@link startValidatedJob} until cleared by reconnect
   * or explicit user resolution via {@link clearLaserUnknownState}.
   *
   * T2-12 part 1 (subscription): UI consumers subscribe via
   * {@link onLaserOutputStateChange}. Internal MachineService reads (e.g.
   * the `'unknown'` gate inside {@link startValidatedJob}) continue to use
   * the synchronous {@link getLaserOutputState} getter. T2-12 part 2 will
   * promote the controller's status-on-error to a formal
   * FAULTED_REQUIRES_INSPECTION state.
   *
   * IMPORTANT: do not assign `_laserOutputState` directly. All writers go
   * through {@link _setLaserOutputState} so subscribers fire on transitions
   * (and only on transitions - no-op writes are skipped).
   */
  private _laserOutputState: LaserOutputState = 'off';
  private _safetyState: SafetyState = safetyStateInitial;
  /**
   * T1-122: explicit `RecoveryState` machine. Pre-T1-122 the runtime
   * type defined in `src/runtime/RecoveryState.ts` (T2-87) was
   * type-only — no production owner held an instance, no triggers
   * fired in production, and `recoveryAllowsStart()` was never
   * consulted by the live start gate. The audit's Phase 2 #6 finding
   * called this out as a "foundation exists but product does not use
   * it" bug. T1-122 wires it: MachineService is the natural owner;
   * `startValidatedJob` consults `recoveryAllowsStart`; `triggerAlarm`
   * fires from the controller-state subscriber when alarm hits during
   * an active job; `triggerEmergencyStop` fires from the safetyOff
   * unknown-outcome path; `acknowledgeRecoveryComplete()` lets the UI
   * clear recovery to 'none' once the user confirms inspection /
   * rehome / reframe. Per-step ack functions (ackInspection /
   * ackUnlock / ackRehome / ackReframe / ackReconnect / ackRecompile)
   * are exposed via `setRecoveryState` for the recovery card UI.
   */
  private _recoveryState: RecoveryState = recoveryStateInitial;
  /**
   * T1-123: WiFi override state. null when no override is active or
   * when the trust verdict is 'trusted' (override is meaningless on a
   * USB connection). Set by the UI's "Start over WiFi anyway" flow
   * via {@link requestWiFiOverride}; cleared by
   * {@link clearWiFiOverride}, by the expiry timer, or implicitly when
   * trust changes from 'untrusted' back to 'trusted'.
   */
  private _wifiOverride: WiFiOverride | null = null;
  /**
   * T1-123: 5-minute default override window. Long enough to start
   * a job; short enough that an unattended LaserForge instance with
   * a WiFi connection can't be hijacked into a job hours later. The
   * UI flow re-prompts on every safety-critical action that needs
   * the override; each grant resets the expiry.
   */
  private static readonly _DEFAULT_WIFI_OVERRIDE_MS = 5 * 60 * 1000;
  // T1-41: G54 work offset captured at the time the user clicked Set Origin.
  // The verify path (`verifySavedOrigin`) compares this to a freshly-queried
  // value at job start. `null` means Set Origin was never run this session
  // (or the snapshot was invalidated, e.g. by disconnect).
  private _savedOriginG54Snapshot: { x: number; y: number; z: number } | null = null;

  /**
   * T1-171 (audit F-014): unsubscribe handle for the auto-M5-on-
   * connect onStateChange listener. The listener auto-unsubscribes
   * once status reaches 'idle' (the T3-90 fire-or-skip gate). If the
   * controller is force-disconnected BEFORE reaching idle, the
   * listener leaks — accumulating one closure per failed connect
   * cycle. T1-171 holds the unsubscribe here so `disconnect()` and
   * `emergencyStop()` can clear it on every disconnect path.
   */
  private _autoM5Unsubscribe: (() => void) | null = null;

  /** T2-12 part 1: subscribers to laser-output-state transitions. */
  private _laserOutputStateListeners: Set<(state: LaserOutputState) => void> = new Set();
  private _safetyStateListeners: Set<SafetyStateListener> = new Set();
  private _recoveryStateListeners: Set<RecoveryStateListener> = new Set();
  private _wifiOverrideListeners: Set<WiFiOverrideListener> = new Set();
  private _wifiOverrideTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * T2-11: service-layer mutex for temporary-laser-on operations. Single
   * field, single owner. Set by {@link tryAcquireOperation} when no
   * operation is active; cleared by {@link releaseOperation}. The
   * existing `_isJobRunning` controller-level lock stays — it gates
   * sendCommand against the streaming-job state. The operation mutex
   * is a layer above it: it gates beginTestFire / runFrame /
   * autoFocus / setOriginAtCurrentPosition / jog against each other.
   *
   * Re-entry policy: same-kind acquire returns true without changing
   * `startedAt` / `sessionId` so the existing test-fire deadman re-entry
   * pattern (`if (this._testFireTimerHandle !== null) clearTimeout` then
   * re-arm) keeps working. Different-kind acquire returns false. Release
   * is idempotent and only clears when the held kind matches.
   */
  private _activeOperation: ActiveOperationState | null = null;
  private _operationSessionCounter = 0;
  private _activeConnectAbortController: AbortController | null = null;
  private _activeConnectPromise: Promise<void> | null = null;

  constructor(
    private readonly controllerRef: MutableRefObject<LaserController>,
    private readonly portRef: MutableRefObject<SerialPortLike | null>,
  ) {}

  /** Acquire an OS wake lock for the duration of an active job.
   *  Prevents Windows USB Selective Suspend and Chromium renderer
   *  throttling, either of which can stall streaming mid-cut.
   *  Best-effort: silently no-ops outside Electron. */
  private async acquireWakeLock(): Promise<void> {
    const api = (globalThis as {
      electronAPI?: { acquireJobWakeLock?: () => Promise<number> };
    }).electronAPI;
    if (!api?.acquireJobWakeLock) return;
    try {
      await api.acquireJobWakeLock();
    } catch (err) {
      console.warn('[MachineService] Failed to acquire wake lock:', err);
    }
  }

  /** Release the wake lock. Idempotent. Best-effort. */
  private async releaseWakeLock(): Promise<void> {
    const api = (globalThis as {
      electronAPI?: { releaseJobWakeLock?: () => Promise<void> };
    }).electronAPI;
    if (!api?.releaseJobWakeLock) return;
    try {
      await api.releaseJobWakeLock();
    } catch {
      /* best-effort — don't fail the job-end path on this */
    }
  }

  getState(): MachineServiceState {
    return {
      isSimulator: this.state.isSimulator,
      messages: [...this.state.messages],
      messageEvents: [...this.state.messageEvents],
    };
  }

  appendMessage(message: string): void {
    const event = legacyMessageToStructuredLogEvent(message);
    this.state.messages = [...this.state.messages, message];
    this.state.messageEvents = [...this.state.messageEvents, event];
  }

  appendLogEvent(input: StructuredLogEventInput): StructuredLogEvent {
    const event = normalizeStructuredLogEvent(input);
    this.state.messages = [...this.state.messages, formatStructuredLogEventForLegacy(event)];
    this.state.messageEvents = [...this.state.messageEvents, event];
    return event;
  }

  setMessages(messages: string[]): void {
    this.state.messages = [...messages];
    this.state.messageEvents = messages.map(message => legacyMessageToStructuredLogEvent(message));
  }

  clearMessages(): void {
    this.state.messages = [];
    this.state.messageEvents = [];
  }

  setSimulator(isSimulator: boolean): void {
    this.state.isSimulator = isSimulator;
  }

  clearJobSession(): void {
    void this.releaseWakeLock();
    this.activeReplay = null;
    this.currentJobLog = null;
    this.activeTicket = null;
    this.activeJobCanvasContext = null;
    this.jobObservedRunning = false;
    this.activeJobSessionId = null;
  }

  /** Read-only accessor — tests and future phases need to inspect
   *  which ticket is running. */
  getActiveTicket(): ValidatedJobTicket | null {
    return this.activeTicket;
  }

  /** Canvas-space toolpath + transform for the running job (T1-11), or null. */
  getActiveJobCanvasContext(): ActiveJobCanvasContext | null {
    return this.activeJobCanvasContext;
  }

  getBurnState(): BurnState {
    return this.burnState;
  }

  onBurnStateChange(cb: BurnStateListener): () => void {
    this.burnStateListeners.add(cb);
    return () => this.burnStateListeners.delete(cb);
  }

  private emitBurnState(): void {
    for (const cb of this.burnStateListeners) cb(this.burnState);
  }

  /**
   * Subscribe to controller traffic for replay + job log. Call once per mount; cleanup on unmount.
   */
  attachJobRecording(controller: LaserController, sink: JobRecordingSink): () => void {
    this.detachRecording?.();
    const recordingSink = sink;

    const unsubProgress = controller.onProgress(prog => {
      if (prog.percentComplete >= 100) {
        const r = this.activeReplay;
        if (r && r.status === 'running') {
          finalizeReplay(r, 'completed', prog.linesAcknowledged);
          saveReplay(r);
          recordingSink.onReplayCompleted({ ...r });
          this.activeReplay = null;
        }
      }
    });

    const unsubError = controller.onError((code, msg) => {
      recordingSink.appendConsoleLine(`ERROR ${code}: ${msg}`);
      const r = this.activeReplay;
      if (r && r.status === 'running') {
        addReplayEntry(r, 'error', msg);
      }
      const jl = this.currentJobLog;
      if (jl && jl.status === 'running') {
        addLogEntry(jl, 'error', `${code}: ${msg}`);
      }
    });

    const unsubRaw = controller.onRawLine((line, dir, kind) => {
      const sysTag = kind === 'system' ? '[sys] ' : '';
      const arrow = dir === 'tx' ? '>' : '<';
      recordingSink.appendConsoleLine(`${sysTag}${arrow} ${line}`);
      const r = this.activeReplay;
      if (r && r.status === 'running') {
        addReplayEntry(r, dir === 'tx' ? 'tx' : 'rx', line);
      }
      const jl = this.currentJobLog;
      if (jl && jl.status === 'running') {
        addLogEntry(jl, dir === 'tx' ? 'sent' : 'received', `${sysTag}${line}`);
      }
    });

    const unsubLifecycle =
      controller.onObjectLifecycle?.((activeObjectIds) => {
        const nextBurned = new Set(this.burnState.burnedIds);
        for (const id of this.burnState.activeIds) {
          if (!activeObjectIds.includes(id)) nextBurned.add(id);
        }
        this.burnState = {
          activeIds: new Set(activeObjectIds),
          burnedIds: nextBurned,
        };
        this.emitBurnState();
      }) ?? (() => {});

    const cleanup = () => {
      unsubProgress();
      unsubError();
      unsubRaw();
      unsubLifecycle();
      this.detachRecording = null;
    };
    this.detachRecording = cleanup;
    return cleanup;
  }

  /**
   * T2-56: subscribe to controller state + progress events so job-log
   * finalization runs whether or not the connection panel is mounted.
   * Pre-T2-56 finalization was driven by a `useEffect` inside
   * `ConnectionPanel.tsx` — if the panel was unmounted (sidebar closed,
   * route change) at the moment the controller transitioned from
   * `'run'` to `'idle'`, the effect didn't fire and finalization was
   * delayed until the panel remounted (or missed entirely if the user
   * never re-opened it).
   *
   * Returns an unsubscribe function that the caller (typically a
   * `useEffect` in `useMachineService`) wires to component teardown.
   * Subscribing twice is safe — each call returns its own unsub, and
   * `tryFinalizeJobLog`'s existing `log.status !== 'running'` early-
   * return makes double-call idempotent.
   *
   * The default `appendMessage` sink writes to `console.info`. UI
   * surfaces that want to display the finalize message can still call
   * `tryFinalizeJobLog` directly with their own appendMessage — the
   * existing `currentJobLog` guard prevents double-finalize.
   */
  attachAutoFinalize(ctrl: LaserController): () => void {
    let lastProgress: JobProgress | null = null;
    const sink = (msg: string): void => {
      console.info('[T2-56 auto-finalize]', msg);
    };
    const unsubState = ctrl.onStateChange((state) => {
      // T1-122: when alarm fires during an active job, transition the
      // RecoveryState machine. The controller's status alone clearing
      // back to idle is no longer enough to start another job —
      // `recoveryAllowsStart` also has to be true, which requires the
      // user to acknowledge the inspection / unlock / rehome / reframe
      // checklist via setRecoveryState (or acknowledgeRecoveryComplete
      // for the bypass). Pre-T1-122 the production path treated post-
      // alarm idle as fully recovered, leaving the user able to start
      // a job after $X without inspecting the workpiece.
      if (state.status === 'alarm' && this.activeTicket != null) {
        this._setRecoveryState(
          triggerAlarm({
            current: this._recoveryState,
            alarmCode: state.alarmCode ?? 0,
            occurredAt: Date.now(),
            // Per the audit, requiresRehome reflects whether the
            // machine supports homing. Conservatively true for GRBL;
            // the recovery card UI surfaces it as a checkbox the user
            // can skip if their machine has no limit switches.
            requiresRehome: true,
          }),
        );
      }
      void this.tryFinalizeJobLog(state, lastProgress, ctrl.isJobRunning, sink);
    });
    const unsubProgress = ctrl.onProgress((progress) => {
      lastProgress = progress;
      void this.tryFinalizeJobLog(ctrl.state, progress, ctrl.isJobRunning, sink);
    });
    return () => {
      unsubState();
      unsubProgress();
    };
  }

  /**
   * When the machine returns idle after a running job, persist the job log.
   */
  async tryFinalizeJobLog(
    machineState: MachineState | null,
    jobProgress: JobProgress | null,
    isJobRunning: boolean,
    appendMessage: (msg: string) => void,
  ): Promise<void> {
    const log = this.currentJobLog;
    if (!log || log.status !== 'running') return;
    const sessionId = this.activeJobSessionId;
    const replay = this.activeReplay;

    if (isJobRunning) {
      this.jobObservedRunning = true;
    }
    if (!this.jobObservedRunning) return;

    const idle = machineState?.status === 'idle';
    const notRunning = !isJobRunning;
    if (!idle || !notRunning) return;

    const linesCompleted = jobProgress?.linesAcknowledged ?? 0;
    const status =
      log.errors > 0 ? 'failed' : linesCompleted >= log.gcodeLines ? 'completed' : 'stopped';

    // T1-199: append the terminal lifecycle event to the persistent
    // ledger before finalizing the log. Mirrors the job-start append
    // at startValidatedJob — together the pair lets support bundles
    // reconstruct duration and outcome of every job. The ticketId
    // comes from the active ticket (we're still inside the job
    // session at this point — activeTicket isn't cleared until the
    // end of this method).
    const finalTicketId = this.activeTicket?.ticketId ?? 'unknown';
    if (status === 'completed') {
      getMachineEventLedger().append({
        kind: 'job-completed',
        t: Date.now(),
        ticketId: finalTicketId,
        linesAcknowledged: linesCompleted,
      });
    } else if (status === 'failed') {
      getMachineEventLedger().append({
        kind: 'job-failed',
        t: Date.now(),
        ticketId: finalTicketId,
        error: `Job finalized with ${log.errors} error(s); ${linesCompleted} of ${log.gcodeLines} lines acknowledged.`,
      });
    } else {
      getMachineEventLedger().append({
        kind: 'job-stopped',
        t: Date.now(),
        ticketId: finalTicketId,
        reason: `Lines acknowledged ${linesCompleted} of ${log.gcodeLines}; controller returned to idle before completion.`,
      });
    }

    finalizeLog(log, status, linesCompleted);
    addLogEntry(
      log,
      'milestone',
      status === 'completed'
        ? `Job completed in ${(log.actualDuration / 1000).toFixed(0)}s`
        : status === 'failed'
          ? `Job failed with ${log.errors} error(s)`
          : 'Job stopped by user',
    );
    const saveResult = await saveJobLog(log);
    if (saveResult.ok) {
      if (saveResult.message) {
        appendMessage(`\u26A0 ${saveResult.message}`);
      } else {
        appendMessage(`\u2713 Job log saved (${status})`);
      }
    } else {
      appendMessage(`\u26A0 ${saveResult.message ?? 'Job log not saved'}`);
    }
    if (this.currentJobLog !== log || this.activeJobSessionId !== sessionId) return;
    if (replay && replay.status === 'running' && this.activeReplay === replay) {
      finalizeReplay(replay, status, linesCompleted);
      saveReplay(replay);
      this.activeReplay = null;
    }
    void this.releaseWakeLock();
    // T1-29: clear unsafe-prior-state flag on terminal job status. Any of
    // 'completed' / 'stopped' / 'failed' counts as a clean transition out
    // of the job-running state — the user observed the outcome and the
    // service finalized the log. The flag's role is to detect "we
    // started a job and never made it here," so any path that reaches
    // here is by definition not unsafe.
    clearUnsafePriorState();
    this.currentJobLog = null;
    this.activeTicket = null;
    this.activeJobCanvasContext = null;
    this.jobObservedRunning = false;
    this.activeJobSessionId = null;
  }

  /** Start a job from a validated ticket. The ticket carries the
   *  gcode lines and metadata; we stash it for later phases that
   *  will verify scene/profile hashes before streaming. */
  // T1-135: delegates to pure validateJobTicket. The wrapper resolves
  // the runtime context (active profile + the GRBL controller-id
  // constant) so the helper can stay free of singleton access.
  private static finitePositive(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
  }

  private readControllerMachineInfo(): {
    maxSpindle: number | null;
    bed: { width: number; height: number } | null;
    accelMmPerS2: number | null;
  } {
    const controller = this.controllerRef.current as LaserController & {
      getMachineInfo?: () => {
        bedWidth?: unknown;
        bedHeight?: unknown;
        maxSpindle?: unknown;
        maxAccelX?: unknown;
        maxAccelY?: unknown;
      };
    };
    const info = controller.getMachineInfo?.();
    const maxSpindle =
      MachineService.finitePositive(controller.maxSpindle)
      ?? MachineService.finitePositive(info?.maxSpindle);
    const bedWidth = MachineService.finitePositive(info?.bedWidth);
    const bedHeight = MachineService.finitePositive(info?.bedHeight);
    const maxAccelX = MachineService.finitePositive(info?.maxAccelX);
    const maxAccelY = MachineService.finitePositive(info?.maxAccelY);
    const accelMmPerS2 =
      maxAccelX !== null && maxAccelY !== null
        ? Math.min(maxAccelX, maxAccelY)
        : (maxAccelX ?? maxAccelY);
    return {
      maxSpindle,
      bed: bedWidth !== null && bedHeight !== null
        ? { width: bedWidth, height: bedHeight }
        : null,
      accelMmPerS2,
    };
  }

  private validateTicket(
    ticket: ValidatedJobTicket,
    scene: Scene,
    runtime: {
      currentStartMode: GcodeStartMode;
      currentSavedOrigin: { x: number; y: number } | null;
      outputFormat: OutputFormat;
    },
  ): { ok: true } | { ok: false; reason: string } {
    const currentProfile = getActiveProfile();
    const machineInfo = this.readControllerMachineInfo();
    const currentFingerprint = buildPipelineJobFingerprint({
      scene,
      startMode: runtime.currentStartMode,
      savedOrigin: runtime.currentSavedOrigin,
      profile: currentProfile,
      controllerMaxSpindle: machineInfo.maxSpindle,
      outputFormat: runtime.outputFormat,
      machineBedFromController: machineInfo.bed,
      controllerAccelMmPerS2: machineInfo.accelMmPerS2,
    });
    return validateJobTicket({
      ticket,
      scene,
      currentProfile,
      currentControllerType: 'grbl',
      currentFingerprint,
    });
  }

  async startValidatedJob(args: {
    ticket: ValidatedJobTicket;
    scene: Scene;
    machineState: MachineState | null;
    notifySimulatorTx: (line: string) => void;
    canvasContext: ActiveJobCanvasContext;
    currentStartMode: GcodeStartMode;
    currentSavedOrigin: { x: number; y: number } | null;
    outputFormat?: OutputFormat;
  }): Promise<void> {
    const {
      ticket,
      scene,
      machineState,
      notifySimulatorTx,
      canvasContext,
      currentStartMode,
      currentSavedOrigin,
      outputFormat = 'grbl',
    } = args;

    if (
      this.activeTicket
      || this.activeJobCanvasContext
      || this.currentJobLog?.status === 'running'
      || this.activeReplay?.status === 'running'
    ) {
      throw new Error('A job is already active. Wait for it to finish or clear the job session.');
    }

    // T1-22: refuse to start a job while laser output state is uncertain.
    // This typically means the previous emergency-laser-off path took the
    // soft-reset fallback (M5 transport failed) or both stages failed. The
    // user must reconnect or run an explicit safety-clear before continuing.
    if (this._laserOutputState === 'unknown') {
      throw new Error(
        'Machine is in an unknown laser-safety state after a previous laser-off failure. '
        + 'Reconnect or clear the safety state before starting a job.',
      );
    }

    // T1-123: refuse to start a job over an untrusted (Falcon WiFi)
    // connection unless the user has explicitly granted a recent
    // override. Pre-T1-123 the production code never consulted trust
    // — start_job over WiFi went through silently, even though the
    // Falcon protocol has no auth (electron/falcon-wifi/FalconHttpClient.ts
    // line 11 documents "No auth of any kind"), so a local-network
    // attacker / fake device / DNS-rebound HTTP responder could
    // accept the job. Default policy is 'medium' (require override
    // with a reason). The override is grantable for 5 min via
    // requestWiFiOverride; trusted USB connections bypass this gate
    // entirely (allowed=true on the trusted branch).
    const wifiGate = this.evaluateActionAllowed('start-job');
    if (!wifiGate.allowed) {
      throw new Error(
        `Job start blocked over an untrusted connection (${wifiGate.trust.label}). `
        + `${wifiGate.userMessage} `
        + 'Connect via USB, or grant a WiFi override before retrying.',
      );
    }

    // T1-122: refuse to start a job while RecoveryState is non-none.
    // Pre-T1-122 this gate was missing from the production start path
    // entirely (the runtime type + triggers in src/runtime/RecoveryState.ts
    // were defined but no production code consumed them). After alarm /
    // disconnect-during-job / emergency-stop / frame-fail / compile-fail
    // the controller may be reachable and report idle, but the user has
    // not acknowledged the recovery checklist (inspect machine / unlock /
    // rehome / reframe / etc.). Recovery transitions back to 'none' only
    // after every required step is done — see RecoveryState.checkRecoveryComplete.
    if (!recoveryAllowsStart(this._recoveryState)) {
      throw new Error(
        `Machine recovery is incomplete (status: ${this._recoveryState.status}). `
        + 'Acknowledge every required recovery step before starting a new job.',
      );
    }

    // F-010/T1-223: the UI already refuses Start while WCS placement is
    // uncertain, but the service is the final production gate before bytes
    // can stream. Use the controller boolean as the source of truth; the
    // optional reason is only diagnostic text.
    if (this.controllerRef.current?.getPlacementUncertain?.() === true) {
      const placementReason =
        this.controllerRef.current.getPlacementUncertainReason?.() ?? 'unknown';
      throw new Error(
        `Work-coordinate state could not be confirmed (reason: ${placementReason}). `
        + 'Reconnect or address the underlying WCS issue before starting a job.',
      );
    }

    const validation = this.validateTicket(ticket, scene, {
      currentStartMode,
      currentSavedOrigin,
      outputFormat,
    });
    if (!validation.ok) {
      throw new Error(validation.reason);
    }

    const lines = [...ticket.gcodeLines];
    const streamableLines = lines
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith(';'));
    if (streamableLines.length === 0) {
      throw new Error('Job contains no streamable G-code lines.');
    }

    await this.acquireWakeLock();
    const sessionId = this.nextJobSessionId++;
    // T1-29: persist unsafe-prior-state flag at job-begin. The flag is
    // cleared on every clean shutdown path (job completion, service
    // disconnect, recovery acknowledgement). If the renderer dies
    // mid-burn or the cable is pulled, the flag survives in
    // localStorage and the next app launch surfaces a recovery
    // dialog before allowing connect — covers the case where firmware
    // reports clean idle on next connect (T1-25's getUnsafeAtConnect
    // returns null) but the user lost their session in the middle of
    // a burn and the workpiece may be partially burnt.
    setUnsafePriorState({
      kind: 'job-running',
      ticketId: ticket.ticketId ?? null,
      startedAt: Date.now(),
    });
    // T1-199: append job-start to the persistent ledger. The
    // commitment point is here — unsafePriorState is set and the
    // controller is about to receive bytes. If the renderer dies
    // between this line and tryFinalizeJobLog, the next session
    // can read the ledger and see the started-but-never-finished
    // job. Pre-T1-199 the job-start event kind was declared but
    // had no writer; ticket arc T1-195 wired emergency-stop +
    // disconnect-while-running + failed-to-start + burn-envelope-
    // divergence, but the four `job-*` lifecycle events were
    // deferred. T1-199 wires job-start here and job-completed /
    // job-stopped / job-failed inside tryFinalizeJobLog.
    getMachineEventLedger().append({
      kind: 'job-start',
      t: Date.now(),
      ticketId: ticket.ticketId,
      sceneHash: ticket.sceneHash,
    });
    try {
      this.jobObservedRunning = false;
      this.activeJobSessionId = sessionId;
      this.activeTicket = ticket;
      this.activeJobCanvasContext = canvasContext;

      this.burnState = emptyBurnState();
      this.emitBurnState();

      const gcodeText = ticket.gcodeText;

      const estimate = gcodeText ? estimateJobTime(gcodeText) : null;

      const jobLog = createJobLog(
        scene.metadata?.name || 'Untitled',
        lines.length,
        estimate ? estimate.formatted : '?',
        scene.layers.filter(l => l.visible && l.output !== false).map(l => ({
          name: l.name,
          mode: l.settings.mode,
          power: l.settings.power.max,
          speed: l.settings.speed,
          passes: l.settings.passes,
        })),
        machineState?.status || 'unknown',
        { x: machineState?.position.x ?? 0, y: machineState?.position.y ?? 0 },
      );
      addLogEntry(jobLog, 'milestone',
        `Job started: ${lines.length} commands (ticket ${ticket.ticketId})`);
      this.currentJobLog = jobLog;

      // T1-88: replay capture is no longer Pro-gated. Capture is a
      // diagnostic tool for support; gating it behind Pro means free users
      // get worse support, which is both unfair and bad for conversion.
      // Visualization (the actual product) can be Pro-gated at the consumer
      // side when a JobReplayViewer component is built. The replay payload
      // is bounded by the existing MAX_RETAINED_REPLAYS=20 cap.
      const layerSettings = scene.layers.filter(l => l.visible && l.output).map(l => ({
        name: l.name,
        mode: l.settings.mode,
        power: l.settings.power.max,
        speed: l.settings.speed,
        passes: l.settings.passes,
      }));
      this.activeReplay = createReplay(
        scene.metadata?.name || 'Untitled',
        lines.length,
        {
          layers: layerSettings,
          material: scene.material?.name || null,
          machineType: scene.machine?.type || null,
        },
        estimate ? estimate.totalSeconds * 1000 : null,
      );

      // T1-46/T2-27: kick off executeJob FIRST so the controller starts streaming
      // immediately; defer the simulator-fan-out loop to a chunked
      // setTimeout. notifySimulatorTx fans out to UI listeners (progress
      // overlays, replay capture mirror); doing 2M synchronous calls
      // before job execution meant the controller didn't see byte 1 until
      // after the entire fan-out completed — multi-second freeze right
      // when the user expects "click Start → laser begins" within
      // ~100ms. Chunking yields between batches so the browser can
      // repaint and the controller's streaming continues uninterrupted.
      // Errors from individual notify callbacks are swallowed (matches
      // the existing per-callback try/catch in notifySimulatorTx) — a
      // broken listener mustn't take down job start. executeJob's own
      // promise carries the streaming/transport error contract.
      const sendPromise = this.controllerRef.current.executeJob(
        { kind: 'gcode-lines', lines, dialect: 'grbl' },
        {
          ticketId: ticket.ticketId,
          sceneHash: ticket.sceneHash,
          profileHash: ticket.profileHash,
          outputHash: ticket.gcodeHash,
        },
      );
      this._notifySimulatorChunked(lines, notifySimulatorTx);
      await sendPromise;
    } catch (err) {
      if (this.activeJobSessionId === sessionId) {
        // T1-87: persist the partial log/replay before clearing refs so
        // support can investigate failed starts. Without this, a thrown
        // sendJob silently nullified currentJobLog/activeReplay — losing
        // the lines that did go out before the throw, the machine state
        // captured at job start, and the throw error itself.
        //
        // Best-effort save: a save failure must NOT block cleanup or the
        // rethrow. saveJobLog returns a promise; we attach .catch and
        // discard the rest with `void`. saveReplay is fire-and-forget by
        // construction (matches the convention at the success-finalize
        // path elsewhere in this file).
        //
        // T2-67 closed T1-87's stopgap: failed-start jobs are finalized
        // with the distinct 'failed_to_start' status (added to JobLog and
        // JobReplay status unions) instead of reusing 'failed'. This lets
        // the log viewer and support tooling distinguish jobs that never
        // started from jobs that ran-and-then-failed mid-stream.
        //
        // Order: addLogEntry BEFORE finalizeLog. finalizeLog doesn't read
        // log.errors today, but if it ever does, having the error entry
        // already counted is the forward-compatible choice.
        const log = this.currentJobLog;
        if (log) {
          addLogEntry(
            log,
            'error',
            `Job failed to start: ${err instanceof Error ? err.message : String(err)}`,
          );
          finalizeLog(log, 'failed_to_start', 0);
          void saveJobLog(log).catch(saveErr => {
            console.warn('[MachineService] T1-87: failed to save failed-start log:', saveErr);
          });
        }

        const replay = this.activeReplay;
        if (replay) {
          finalizeReplay(replay, 'failed_to_start', 0);
          saveReplay(replay);
        }

        // T1-176 (external audit Critical #4): capture whether the
        // host observed the controller actually entering 'run' state
        // BEFORE we clear `jobObservedRunning` for cleanup. If the
        // host saw 'run', physical streaming was happening; the
        // unsafe-prior-state flag MUST survive.
        const sawRun = this.jobObservedRunning;
        const controllerThinksRunning = this.controllerRef.current?.isJobRunning === true;
        // T1-220 (v30 audit #8): defense-in-depth. The two flags
        // above can both be cleared synchronously by a controller's
        // `_abortJob()` between the throw and the catch site. A
        // monotonic byte-count counter survives that — once a job
        // line hits the wire, the counter is non-zero, and the
        // carve-out below preserves the unsafe flag accordingly.
        const jobLinesWritten =
          this.controllerRef.current?.getJobLinesWrittenSinceJobStart?.() ?? 0;

        this.activeReplay = null;
        this.currentJobLog = null;
        this.activeTicket = null;
        this.activeJobCanvasContext = null;
        this.jobObservedRunning = false;
        this.activeJobSessionId = null;
        void this.releaseWakeLock();
        // T1-29 + T1-176 (external audit Critical #4): pre-T1-176
        // this branch unconditionally called `clearUnsafePriorState()`
        // on the assumption that "a failed-start counts as a clean
        // shutdown because the job never reached running." The audit
        // pushed back: "failed to start" is inferred from an exception,
        // not from physical streaming evidence. `executeJob` can set
        // `_isJobRunning = true` and write the first header lines to
        // the wire BEFORE throwing on a downstream bounds / status /
        // transport error. If any byte hit the wire, the recovery
        // flag must survive to the next launch.
        //
        // T1-220 (v30 audit #8): strongest positive evidence that
        // NOTHING streamed is the conjunction of THREE signals all
        // being clean — host never observed 'run' state AND the
        // controller's own `isJobRunning` flag is false AND the
        // transport-level byte counter is zero. The counter is the
        // load-bearing one; flags can be cleared synchronously by a
        // controller-side abort, the counter cannot.
        if (!sawRun && !controllerThinksRunning && jobLinesWritten === 0) {
          clearUnsafePriorState();
        } else {
          console.warn(
            `[MachineService] T1-176/T1-220: failed-start preserves unsafe-prior-state flag `
            + `(sawRun=${sawRun}, controllerThinksRunning=${controllerThinksRunning}, `
            + `jobLinesWritten=${jobLinesWritten}). `
            + 'Next launch will surface a recovery dialog before further machine commands.',
          );
        }
        // T1-195: append every failed-start to the persistent ledger
        // — both the true failed-start case (no streaming evidence)
        // and the streamed-then-threw case. Support bundles use this
        // to distinguish ticket-shape errors from mid-stream throws.
        getMachineEventLedger().append({
          kind: 'failed-to-start',
          t: Date.now(),
          ticketId: ticket.ticketId ?? 'unknown',
          error: err instanceof Error ? err.message : String(err),
          sawRun,
          controllerThinksRunning,
        });
      }
      throw err;
    }
  }

  applyReplayOutcome(
    replay: JobReplay,
    outcome: NonNullable<JobReplay['outcome']>,
  ): void {
    replay.outcome = outcome;
    saveReplay(replay);
    if (replay.settings.material) {
      for (const layer of replay.settings.layers) {
        recordMaterialOutcome({
          material: replay.settings.material,
          machineType: replay.settings.machineType || 'diode',
          mode: layer.mode,
          power: layer.power,
          speed: layer.speed,
          passes: layer.passes,
          outcome,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // ─── T1-22 LASER SAFETY STATE ─────────────────────────────────────

  /**
   * Read the current laser-output safety state. T1-22.
   *
   * - `'off'`: Last known state is laser off. Default after connect.
   * - `'on'`: A test-fire is currently active (laser intentionally on).
   * - `'unknown'`: A previous {@link LaserController.safetyOff} returned
   *   `soft-reset` or `failed` — the M5 path did not provide a clean confirmation.
   *   {@link startValidatedJob} refuses while in this state.
   */
  getLaserOutputState(): LaserOutputState {
    return this._laserOutputState;
  }

  /**
   * T2-44: read the canonical safety-operation state derived from
   * SafetyActionResult outcomes.
   */
  getSafetyState(): SafetyState {
    return this._safetyState;
  }

  /**
   * T2-11 / T1-222: try to acquire the operation mutex for `kind`.
   * Returns an {@link OperationLease} on success (caller now holds the
   * mutex), `null` if a different kind is already active.
   *
   * **Every successful acquire mints a FRESH `sessionId`**, even on
   * same-kind re-acquire. This is the core of the lease-token race
   * protection (T1-222): a stale release from a prior round
   * (deadman `.finally`, cancelled-but-still-pending callback) finds
   * its lease's `sessionId` no longer matches the current operation
   * and becomes a silent no-op. Pre-T1-222 the same `sessionId` was
   * shared across same-kind re-acquires, so the deadman `.finally`
   * could clear a fresh round's mutex.
   *
   * The deadman re-entry pattern in `beginTestFire` continues to
   * work because the OLD `setTimeout` handle is `clearTimeout`'d
   * before the second acquire — the old callback never runs, so the
   * stale-release path is the relevant defense, and the fresh
   * `sessionId` ensures it stays silent.
   *
   * Failure modes returned as `null`:
   *   - A different operation is currently active (e.g. test-fire is
   *     held; caller asked for frame-dot).
   *
   * Caller MUST pair every successful acquire with exactly one
   * {@link releaseOperation} call passing the returned lease
   * (try/finally is the right shape for synchronous and async
   * operations alike).
   */
  tryAcquireOperation(kind: ActiveOperationKind): OperationLease | null {
    if (this._activeOperation == null || this._activeOperation.kind === kind) {
      this._activeOperation = {
        kind,
        startedAt: Date.now(),
        sessionId: ++this._operationSessionCounter,
      };
      return { kind, sessionId: this._activeOperation.sessionId };
    }
    return null;
  }

  /**
   * T2-11 / T1-222: release the operation mutex if the supplied lease
   * matches the active operation. Both `kind` AND `sessionId` must
   * match — a stale-round lease (operation was already released and a
   * fresh same-kind round was acquired) is a SILENT no-op. This is
   * the race the lease tokens close: pre-T1-222 a stale `releaseOperation('testFire')`
   * from a deadman `.finally` running after a fresh `beginTestFire`
   * would clear the new round's mutex.
   *
   * Idempotent — calling release with no operation held is a no-op.
   * A kind-mismatch lease (which shouldn't be reachable via the
   * production API surface but is possible for hand-constructed
   * leases in tests) emits a warn, because it almost certainly means
   * a try/finally pair is wrong.
   */
  releaseOperation(lease: OperationLease): void {
    if (this._activeOperation == null) return;
    if (this._activeOperation.sessionId !== lease.sessionId) {
      // Stale lease — the round this lease was minted in has already
      // ended and a fresh round (possibly of the same kind) is in
      // flight. Silent no-op preserves the fresh round's mutex.
      return;
    }
    if (this._activeOperation.kind !== lease.kind) {
      console.warn(
        `[T1-222] releaseOperation(lease kind='${lease.kind}', sid=${lease.sessionId}) called while '${this._activeOperation.kind}' (sid=${this._activeOperation.sessionId}) is active; ignoring`,
      );
      return;
    }
    this._activeOperation = null;
  }

  /**
   * T2-11: read-only snapshot of the active operation. `null` when no
   * operation is held. Returns a defensive copy. Consumed by T1-30's
   * (future) computeCommandGates as the `opState === 'none'` source so
   * UI gates can refuse frame / jog / test-fire while another operation
   * is in flight.
   */
  getActiveOperation(): ActiveOperationState | null {
    return this._activeOperation == null ? null : { ...this._activeOperation };
  }

  /**
   * T2-12 part 1: subscribe to laser-output-state transitions.
   *
   * Returns an unsubscribe function. The callback fires when the state
   * actually changes; no-op writes (e.g. notifyTestFire('end') while
   * already 'off') are skipped by {@link _setLaserOutputState}'s
   * change-detection. Mirrors the HistoryManager.onChange and
   * EntitlementService.onChange patterns elsewhere in the codebase.
   *
   * Synchronous reads still go through {@link getLaserOutputState}.
   */
  onLaserOutputStateChange(cb: LaserOutputStateListener): () => void {
    this._laserOutputStateListeners.add(cb);
    return () => this._laserOutputStateListeners.delete(cb);
  }

  /**
   * T2-44: subscribe to safety-state transitions driven by pause/resume/
   * stop/emergency-stop outcomes. Consumers can use this for recovery
   * cards and command gating without re-interpreting controller calls.
   */
  onSafetyStateChange(cb: SafetyStateListener): () => void {
    this._safetyStateListeners.add(cb);
    return () => this._safetyStateListeners.delete(cb);
  }

  /**
   * T1-122: read the current `RecoveryState`. Synchronous; UI consumers
   * subscribe via {@link onRecoveryStateChange} for transition events.
   */
  getRecoveryState(): RecoveryState {
    return this._recoveryState;
  }

  /**
   * T1-122: subscribe to RecoveryState transitions. Fires when the
   * service moves the state machine via {@link _setRecoveryState}
   * (alarm trigger, emergency-stop trigger, ack methods,
   * acknowledgeRecoveryComplete). Returns an unsubscribe function.
   */
  onRecoveryStateChange(cb: RecoveryStateListener): () => void {
    this._recoveryStateListeners.add(cb);
    return () => this._recoveryStateListeners.delete(cb);
  }

  /**
   * T1-122: replace the recovery state.
   *
   * T1-219 (v30 audit #4): direct clears of an active recovery
   * (transitions from `current.status !== 'none'` to
   * `next.status === 'none'`) now require an
   * `UnsafeRecoveryBypassToken`. The legitimate clear path runs
   * through `applyRecoveryAck(step)` (added below), which advances
   * the per-step checklist and auto-transitions to `'none'` when
   * every required step is done. Non-clearing transitions
   * (entering recovery or moving within recovery) are unchanged —
   * they don't need a token.
   *
   * Used by:
   *   - the legitimate clear path INSIDE `applyRecoveryAck`
   *     (calling without a token is safe there because the
   *     applied ack proves the checklist completed).
   *   - direct transitions to non-`'none'` states (e.g.
   *     `triggerAlarm` / `triggerEmergencyStop`) at the service's
   *     own private call sites.
   *   - test harnesses that need to set up an arbitrary
   *     non-`'none'` state for fixture purposes (no token
   *     required since they're not clearing).
   *   - bypass paths that explicitly mint a token via
   *     `createUnsafeRecoveryBypassToken(reason)`.
   */
  setRecoveryState(next: RecoveryState, token?: UnsafeRecoveryBypassToken): void {
    if (
      next.status === 'none'
      && this._recoveryState.status !== 'none'
      && !isUnsafeRecoveryBypassToken(token)
    ) {
      throw new Error(
        'setRecoveryState({status:"none"}) requires an UnsafeRecoveryBypassToken '
        + 'when an active recovery is in flight. Use applyRecoveryAck(step) for '
        + 'the legitimate per-step clear path, or mint a token via '
        + 'createUnsafeRecoveryBypassToken(reason) for an explicit bypass.',
      );
    }
    this._setRecoveryState(next);
  }

  /**
   * T1-219 (v30 audit #4): apply a single recovery-checklist step
   * ack. Replaces the pre-T1-219 pattern where the UI computed
   * `ackInspection(currentState)` etc. itself and passed the result
   * to the public `setRecoveryState`. Now the service owns the
   * transition so a future UI/debug/test cannot bypass the
   * checklist by calling `setRecoveryState({status:'none'})`
   * directly — that path now requires a bypass token.
   *
   * The runtime helpers (in `src/runtime/RecoveryState.ts`) handle
   * the discriminated-union per-status logic and the auto-clear
   * via `checkRecoveryComplete`. This method just applies one and
   * fires the listener.
   */
  applyRecoveryAck(
    step: 'inspection' | 'unlock' | 'rehome' | 'reframe' | 'reconnect' | 'recompile',
  ): void {
    let next: RecoveryState;
    switch (step) {
      case 'inspection': next = ackInspection(this._recoveryState); break;
      case 'unlock':     next = ackUnlock(this._recoveryState); break;
      case 'rehome':     next = ackRehome(this._recoveryState); break;
      case 'reframe':    next = ackReframe(this._recoveryState); break;
      case 'reconnect':  next = ackReconnect(this._recoveryState); break;
      case 'recompile':  next = ackRecompile(this._recoveryState); break;
    }
    // The ack helpers can produce a 'none' transition (the
    // legitimate auto-clear). Bypass the public setRecoveryState
    // token gate by going through the private setter directly —
    // we KNOW this transition is legitimate because we just
    // computed it from one of the typed ack helpers.
    if (next.status === 'none' && this._recoveryState.status !== 'none') {
      getMachineEventLedger().append({
        kind: 'recovery-cleared',
        t: Date.now(),
        acknowledgedBy: 'auto',
      });
    }
    this._setRecoveryState(next);
  }

  /**
   * T1-122: user-explicit "I have inspected and acknowledge it's safe"
   * clear. Used by a future "Reset recovery" button that bypasses the
   * per-step checklist when the user has done all the physical-world
   * steps and just wants to clear the gate.
   *
   * T1-219 (v30 audit #4): now requires an
   * `UnsafeRecoveryBypassToken`. The audit's worry: "a UI path,
   * debug path, or future feature clears recovery after alarm/
   * E-stop/disconnect without rehome/reframe/inspection actually
   * completed." Requiring a token forces every bypass to carry a
   * reason string and to log a console warning at mint time so
   * the bypass is attributable in support bundles.
   */
  acknowledgeRecoveryComplete(token?: UnsafeRecoveryBypassToken): void {
    // No-op when recovery is already cleared. The token is about
    // authorizing a BYPASS of an active checklist — there's nothing
    // to bypass when recovery is already 'none', so don't require
    // the token for this idempotent call.
    if (this._recoveryState.status === 'none') {
      return;
    }
    if (!isUnsafeRecoveryBypassToken(token)) {
      throw new Error(
        'acknowledgeRecoveryComplete requires an UnsafeRecoveryBypassToken '
        + 'when an active recovery is in flight. For the normal per-step '
        + 'checklist clear, use applyRecoveryAck(step). Mint a token via '
        + 'createUnsafeRecoveryBypassToken(reason) only when intentionally '
        + 'bypassing the checklist (e.g. a "Reset recovery" diagnostic '
        + 'button after the user manually inspected the machine).',
      );
    }
    // T1-201: record the user-explicit clear in the persistent ledger.
    // Append BEFORE the state transition so the ledger entry exists
    // even if _setRecoveryState throws via a listener callback.
    getMachineEventLedger().append({
      kind: 'recovery-cleared',
      t: Date.now(),
      acknowledgedBy: 'user',
    });
    this._setRecoveryState({ status: 'none' });
  }

  private _setRecoveryState(next: RecoveryState): void {
    if (this._recoveryState === next) return;
    this._recoveryState = next;
    for (const cb of this._recoveryStateListeners) {
      cb(next);
    }
  }

  /**
   * T1-123: derive the connection trust verdict from the active
   * device profile's connection kind. Pre-T1-123 the production code
   * never consulted trust at all — every connection was treated
   * equivalently, even Falcon WiFi which is unauthenticated by
   * protocol design (see electron/falcon-wifi/FalconHttpClient.ts:11
   * "No auth of any kind"). Now safety-critical actions are gated
   * via {@link evaluateActionAllowed}; the UI surfaces the trust
   * label so the user can tell which connection is which.
   *
   * Trusted: serial / USB; Untrusted: falcon-wifi; Partial:
   * unknown (no profile, or unrecognized kind). Simulator detection
   * is filed as T1-123-followup since it requires UI-side knowledge
   * not currently routed through MachineService.
   */
  getConnectionTrust(): TrustClassification {
    // Mirror `getProfileConnectionKind`'s convention from
    // src/core/devices/DeviceProfile.ts: a profile with no explicit
    // `connection.kind` field — and the no-profile case — both default
    // to 'serial' (the historical default for legacy profiles that
    // predate the `connection` type). 'unknown' is reserved for a
    // future explicit-unknown signal. Only the explicit
    // `'falcon-wifi'` profile kind triggers the untrusted branch.
    const profile = getActiveProfile();
    const kind = profile?.connection?.kind ?? 'serial';
    if (kind === 'falcon-wifi') {
      return classifyConnectionTrust('wifi');
    }
    return classifyConnectionTrust('usb-serial');
  }

  /**
   * T1-123: read the current WiFi override (or null if none active).
   * Override expiry is checked at read time so a stale override is
   * never returned even if the timer hasn't fired yet (defense-in-
   * depth against system-clock drift between grant and check).
   */
  getWiFiOverride(): WiFiOverride | null {
    if (this._wifiOverride == null) return null;
    if (Date.now() >= this._wifiOverride.expiresAt) {
      this._setWiFiOverride(null);
      return null;
    }
    return this._wifiOverride;
  }

  /**
   * T1-123: subscribe to WiFi-override transitions. Fires when the
   * override is granted, cleared, or expires.
   */
  onWiFiOverrideChange(cb: WiFiOverrideListener): () => void {
    this._wifiOverrideListeners.add(cb);
    return () => this._wifiOverrideListeners.delete(cb);
  }

  /**
   * T1-123: grant a WiFi override. Caller (typically the UI's
   * "Start over WiFi anyway" dialog) supplies a reason string that
   * lands in the audit log. Default duration is 5 minutes; pass an
   * explicit `durationMs` for a different window. Re-granting before
   * expiry RESETS the timer (matches the UI flow where each
   * safety-critical action re-prompts).
   *
   * Throws when reason is empty/whitespace — every override must be
   * paired with a user-supplied justification.
   */
  requestWiFiOverride(reason: string, durationMs?: number): WiFiOverride {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error('requestWiFiOverride requires a non-empty reason string.');
    }
    const now = Date.now();
    const ms = durationMs == null
      ? MachineService._DEFAULT_WIFI_OVERRIDE_MS
      : Math.max(0, Math.floor(durationMs));
    const next: WiFiOverride = {
      reason,
      grantedAt: now,
      expiresAt: now + ms,
    };
    this._setWiFiOverride(next);
    return next;
  }

  /**
   * T1-123: clear the WiFi override (user pressed "Cancel" or the
   * connection switched back to USB). Idempotent — no-op when no
   * override is active.
   */
  clearWiFiOverride(): void {
    this._setWiFiOverride(null);
  }

  /**
   * T1-123: combined trust + override + policy evaluation for a
   * safety-critical action. Returns the audit-derived
   * {@link ActionPolicy} so callers (UI buttons, service-layer
   * gates) can branch on `allowed` and surface `userMessage` to the
   * operator. Default policy is 'medium' (requires explicit
   * override) — the strictest practical default that doesn't break
   * single-USB users, who get 'allow' on the trusted-connection
   * branch.
   *
   * If a non-expired override is active, the override-active branch
   * returns 'allow' for the action. The override is consulted
   * separately from the trust verdict so trust isn't artificially
   * "upgraded".
   */
  evaluateActionAllowed(action: FalconWiFiAction): {
    readonly allowed: boolean;
    readonly userMessage: string;
    readonly trust: TrustClassification;
    readonly overrideActive: boolean;
  } {
    const trust = this.getConnectionTrust();
    const override = this.getWiFiOverride();
    const overrideActive = override != null;
    if (trust.tier === 'trusted') {
      return { allowed: true, userMessage: '', trust, overrideActive };
    }
    if (overrideActive) {
      return {
        allowed: true,
        userMessage: `WiFi override active (reason: ${override?.reason ?? ''}).`,
        trust,
        overrideActive,
      };
    }
    const policy = evaluateWiFiActionPolicy({
      action,
      trust,
      policyMode: 'medium',
    });
    return {
      allowed: policy.allowed && policy.kind !== 'require-override',
      userMessage: policy.userMessage,
      trust,
      overrideActive,
    };
  }

  private _setWiFiOverride(next: WiFiOverride | null): void {
    if (this._wifiOverride === next) return;
    this._wifiOverride = next;
    if (this._wifiOverrideTimer != null) {
      clearTimeout(this._wifiOverrideTimer);
      this._wifiOverrideTimer = null;
    }
    if (next != null) {
      const remaining = Math.max(0, next.expiresAt - Date.now());
      this._wifiOverrideTimer = setTimeout(() => {
        // Re-read at fire time so a clearWiFiOverride that arrived
        // first doesn't get clobbered.
        if (this._wifiOverride === next) this._setWiFiOverride(null);
      }, remaining);
      // Browser timers do not expose unref(), but Node-backed tests do.
      // Do not let the default 5-minute override expiry keep a passed
      // one-file test process alive.
      (this._wifiOverrideTimer as { unref?: () => void }).unref?.();
    }
    for (const cb of this._wifiOverrideListeners) {
      cb(next);
    }
  }

  /**
   * T3-90 (T1-25 follow-up): arm a one-shot listener that fires
   * `M5 S0` after the connect-time safe-state handshake reports a
   * clean idle/FS:0,0 verdict, when the active profile has
   * `autoM5OnConnect: true`. The listener auto-unsubscribes on the
   * first status report that records a verdict, regardless of
   * whether M5 was sent.
   *
   * Pre-arm gates:
   *   - Active profile must exist and have `autoM5OnConnect === true`.
   *   - Controller must expose `getUnsafeAtConnect`. Without it (e.g.
   *     a future non-GRBL controller), the listener is a no-op.
   *
   * Fire gates:
   *   - Status must transition to `'idle'`.
   *   - `getUnsafeAtConnect()` must return `null` (T1-25 verdict
   *     is clean — no alarm / run / hold / unsafe-residual-spindle).
   */
  private _armAutoM5OnConnect(): void {
    const profile = getActiveProfile();
    if (profile?.autoM5OnConnect !== true) return;

    const ctrl = this.controllerRef.current;
    const getUnsafeAtConnect =
      typeof (ctrl as { getUnsafeAtConnect?: () => unknown }).getUnsafeAtConnect === 'function'
        ? (ctrl as { getUnsafeAtConnect: () => unknown }).getUnsafeAtConnect.bind(ctrl)
        : null;
    if (getUnsafeAtConnect == null) return;

    // T1-171 (audit F-014): defensively tear down a prior arm before
    // attaching a fresh listener — connect → connect without an
    // intervening disconnect cleanup is not a supported flow in
    // production, but the audit calls out that a force-disconnected
    // controller can leak its onStateChange closure if the listener
    // never sees 'idle'. Calling _clearAutoM5Listener here closes
    // that window. The bulk of the cleanup is in disconnect() /
    // emergencyStop() which also call this method.
    this._clearAutoM5Listener();

    let unsubscribed = false;
    const unsubscribe = ctrl.onStateChange((state) => {
      if (unsubscribed) return;
      if (state.status !== 'idle') return;
      // Fire-or-skip is one-shot: idle is the first reporter slot
      // T1-25 uses to record a verdict. Past idle, the verdict is
      // either null (safe) or set (unsafe). Either way, the auto-M5
      // window has closed.
      unsubscribed = true;
      try {
        const verdict = getUnsafeAtConnect();
        if (verdict === null) {
          // T1-161 (audit F-010): route through MachineCommandGateway
          // instead of calling ctrl.sendCommand directly. The gateway
          // short-circuits source='internal' to a passthrough so behavior
          // is byte-identical, but the choke-point invariant is
          // preserved — `tests/no-direct-sendcommand-outside-gateway.test.ts`
          // (a source-scan source-pin) now passes and stays the canonical
          // enforcement for future audit logging / rate limiting.
          new MachineCommandGateway(ctrl).sendCommand('M5 S0', 'internal');
        }
      } catch {
        /* ignore: auto-M5 is defense-in-depth; primary safety paths
           (T1-22, T1-23, T1-26) cover run-time M-state. */
      } finally {
        // T1-171: clear the stashed handle once the listener has
        // fired its one-shot. A double-fire is impossible (the
        // `unsubscribed` flag above gates it); clearing the handle
        // here is for accounting — `_clearAutoM5Listener` should be
        // a no-op after this point.
        unsubscribe();
        if (this._autoM5Unsubscribe === unsubscribe) {
          this._autoM5Unsubscribe = null;
        }
      }
    });
    this._autoM5Unsubscribe = unsubscribe;
  }

  /**
   * T1-171 (audit F-014): tear down the auto-M5-on-connect listener
   * unconditionally. Called from `disconnect()` and `emergencyStop()`
   * so a controller that was force-disconnected before reaching idle
   * doesn't leave its onStateChange closure attached.
   */
  private _clearAutoM5Listener(): void {
    if (this._autoM5Unsubscribe === null) return;
    const fn = this._autoM5Unsubscribe;
    this._autoM5Unsubscribe = null;
    try { fn(); } catch { /* listener may have already detached */ }
  }

  /**
   * T2-12 part 1: canonical writer for {@link _laserOutputState}.
   * No-op writes (next === current) skip the notify so subscribers
   * only see real transitions.
   */
  private _setLaserOutputState(next: LaserOutputState): void {
    if (this._laserOutputState === next) return;
    this._laserOutputState = next;
    for (const cb of this._laserOutputStateListeners) {
      cb(next);
    }
  }

  private _setSafetyState(next: SafetyState): void {
    if (safetyStatesEqual(this._safetyState, next)) return;
    this._safetyState = next;
    for (const cb of this._safetyStateListeners) {
      cb(next);
    }
  }

  private _recordSafetyResult(result: SafetyActionResult): SafetyActionResult {
    this._setSafetyState(transitionFromSafetyResult(
      this._safetyState,
      safetyResultForStateMachine(result),
      Date.now(),
    ));
    return result;
  }

  /**
   * T1-46: deferred, chunked simulator-tx fan-out. Walks `lines` in
   * NOTIFY_CHUNK-sized batches, invoking `notify` synchronously inside
   * each batch and yielding to the macrotask queue between batches via
   * `setTimeout(..., 0)`. The first batch is also deferred so `sendJob`
   * (called immediately before this) is on the event loop ahead of the
   * notification work.
   *
   * Per-call errors are swallowed (matches the existing per-listener
   * try/catch shape in `notifySimulatorTx` callers) — a broken listener
   * must not break job start. Tests pin both the deferred-first-call
   * contract and the all-lines-eventually-delivered contract.
   *
   * NOTIFY_CHUNK is tuned for "yield often enough to repaint, batch
   * large enough that fan-out finishes within seconds for million-line
   * jobs." 1000 lines per chunk × ~16ms paint cadence ≈ 60k lines/sec
   * sustained while remaining responsive.
   */
  private _notifySimulatorChunked(
    lines: string[],
    notify: (line: string) => void,
  ): void {
    const NOTIFY_CHUNK = 1000;
    let idx = 0;
    // T1-170 (audit F-016): rate-limited observability for broken
    // listeners. Pre-T1-170 the catch silently swallowed every error,
    // so a broken simulator listener could fail every line of a
    // million-line job without operator-visible signal. The audit
    // recommended "first failure + final count" — first failure
    // surfaces the error TYPE so a support bundle can identify it,
    // and the final count signals how widespread the failure was.
    let failureCount = 0;
    let firstError: unknown;
    const tick = (): void => {
      const end = Math.min(idx + NOTIFY_CHUNK, lines.length);
      for (; idx < end; idx++) {
        try {
          notify(lines[idx]);
        } catch (err: unknown) {
          // broken listener must not break the chunked loop (kept the
          // hard contract); only the observability changes
          if (failureCount === 0) {
            firstError = err;
            console.warn(
              '[MachineService] _notifySimulatorChunked: simulator listener threw on line %d. Suppressing further per-line warnings; a summary will be logged when the chunked notification completes.',
              idx,
              err,
            );
          }
          failureCount++;
        }
      }
      if (idx < lines.length) {
        setTimeout(tick, 0);
      } else if (failureCount > 1) {
        // Final summary: include the first-seen error so support bundles
        // can correlate the count with the cause.
        console.warn(
          '[MachineService] _notifySimulatorChunked: simulator listener failed on %d of %d lines (first error attached).',
          failureCount,
          lines.length,
          firstError,
        );
      }
    };
    setTimeout(tick, 0);
  }

  /**
   * Coordinator notifies the service when test-fire transitions begin/end.
   * Called from {@link ExecutionCoordinator.beginTestFire} after M3 succeeds and
   * from the deadman/{@link ExecutionCoordinator.endTestFire} path.
   *
   * `'end'` does not overwrite an `'unknown'` state — that escalation must be
   * resolved explicitly. T1-22.
   */
  notifyTestFire(phase: 'begin' | 'end'): void {
    if (phase === 'begin') {
      // Begin always wins: we explicitly turned the laser on.
      this._setLaserOutputState('on');
      return;
    }
    // 'end'
    if (this._laserOutputState !== 'unknown') {
      this._setLaserOutputState('off');
    }
  }

  /**
   * Coordinator reports the structured outcome of a {@link LaserController.safetyOff}
   * call. M5 path success → laser is confirmed off. Soft-reset fallback or
   * failure → laser-output state is no longer trustworthy and we mark
   * `'unknown'` so {@link startValidatedJob} refuses until cleared. T1-22.
   */
  notifyLaserSafetyOutcome(stage: 'm5' | 'soft-reset' | 'failed'): void {
    // T1-198: persist the safetyOff outcome to the MachineEventLedger
    // so support bundles can reconstruct the full safety-action
    // sequence. The 'm5' outcome confirms laser-off; 'soft-reset' and
    // 'failed' raise the safety-state machine to 'unknown' AND trigger
    // the recovery checklist below. Persisting the stage here is the
    // observability counterpart to the in-memory state change — a
    // future support bundle can show "M5 succeeded twice, soft-reset
    // once, failed once" without depending on console.warn capture.
    getMachineEventLedger().append({
      kind: 'safety-off',
      t: Date.now(),
      stage,
    });
    if (stage === 'm5') {
      this._setLaserOutputState('off');
    } else {
      // soft-reset or failed — treat both as uncertain. Soft reset disables
      // laser output at firmware level, but the M5-path indeterminacy means
      // the planner state is unknown and a fresh connection check is the
      // safest reset.
      this._setLaserOutputState('unknown');
      // T1-122: a soft-reset / failed safetyOff outcome means the
      // laser-off contract was indeterminate AND the controller was
      // forced into a known-but-uncertain state. Treat that the same
      // as an emergency-stop from the recovery-checklist perspective:
      // the user should reconnect, rehome, and reframe before the
      // next job. The 'unknown' laser-output state already throws on
      // start (T1-22 above); this trigger means even after the user
      // clears that flag via clearLaserUnknownState, recovery still
      // gates the start until the checklist is acknowledged.
      this._setRecoveryState(
        triggerEmergencyStop({
          current: this._recoveryState,
          occurredAt: Date.now(),
        }),
      );
    }
  }

  /**
   * Explicitly clear an `'unknown'` laser-safety state (user-resolved).
   * No-op if state is not currently `'unknown'` (avoids accidentally
   * downgrading an active `'on'` state). T1-22.
   */
  clearLaserUnknownState(): void {
    if (this._laserOutputState === 'unknown') {
      this._setLaserOutputState('off');
    }
  }

  // ─── CONNECTION ─────────────────────────────────────────

  async cancelActiveConnect(reason: Error = new Error('Connection cancelled by user')): Promise<boolean> {
    const controller = this._activeConnectAbortController;
    const activeConnect = this._activeConnectPromise;
    if (!controller) return false;

    if (!controller.signal.aborted) {
      controller.abort(reason);
    }

    if (activeConnect) {
      try {
        await activeConnect;
      } catch (err) {
        if (!controller.signal.aborted) throw err;
      }
    }

    return true;
  }

  async connectRealLaser(baudRate: number, signal?: AbortSignal): Promise<void> {
    // T1-50: accept an optional AbortSignal. T2-33 made
    // WebSerialPort.requestAndOpen signal-aware; this service passes
    // the same signal down so user-cancel during port selection/open
    // uses the T1-49 cleanup path. GrblController.connect still checks
    // at the service await boundary until its handshake is signal-aware.
    signal?.throwIfAborted();
    if (this._activeConnectAbortController !== null) {
      throw new Error('Connection already in progress');
    }
    if (!WebSerialPort.isSupported()) {
      throw new Error('Web Serial not supported in this browser');
    }
    // T1-49: previously `portRef.current = ws` was assigned BEFORE the
    // open + handshake calls, so a thrown `requestAndOpen` (permission
    // denied, port busy, getWriter/getReader failure) or a thrown
    // `controller.connect` (handshake timeout, wrong-device, baud
    // mismatch) left the half-open `WebSerialPort` instance pinned on
    // portRef. Subsequent `portRef.current != null` checks treated the
    // app as connected; reconnection often failed until app reload.
    //
    // Now: only assign portRef on full success. On any failure path,
    // close the half-open port (sync today, async after T2-31), null
    // portRef if it ended up pointing at the failed port, attempt a
    // controller disconnect to release any partial connect state, and
    // rethrow so the UI's catch sees the original error. T1-50 Part B
    // adds `signal?.throwIfAborted()` at each await point so an
    // aborted signal routes through the same cleanup path.
    const connectAbortController = new AbortController();
    this._activeConnectAbortController = connectAbortController;
    const forwardExternalAbort = (): void => {
      connectAbortController.abort(signal?.reason instanceof Error ? signal.reason : new Error('Connection aborted by user'));
    };
    signal?.addEventListener('abort', forwardExternalAbort, { once: true });
    const connectSignal = connectAbortController.signal;
    let activeConnectResolve: () => void = () => {};
    let activeConnectReject: (err: unknown) => void = () => {};
    const activeConnect = new Promise<void>((resolve, reject) => {
      activeConnectResolve = resolve;
      activeConnectReject = reject;
    });
    void activeConnect.catch(() => {});
    this._activeConnectPromise = activeConnect;

    let connectError: unknown;
    let ws: WebSerialPort | null = null;
    try {
      ws = createSerialPort('web') as WebSerialPort;
      await ws.requestAndOpen(baudRate, connectSignal);
      connectSignal.throwIfAborted();
      await this.controllerRef.current.connect(ws, connectSignal);
      connectSignal.throwIfAborted();
      this.portRef.current = ws;
      this.state.isSimulator = false;
      // T1-22: fresh connection clears any stale unknown laser-safety state
      // from a previous session.
      this._setLaserOutputState('off');
      // T3-90 (T1-25 follow-up): if the active profile opts in, fire
      // `M5 S0` once the controller's first idle status report records
      // a clean T1-25 verdict. The listener auto-unsubscribes after
      // firing or after status enters a non-clean state. Defense-in-
      // depth: clears any modal M3/M4 state from a previous session.
      this._armAutoM5OnConnect();
    } catch (err) {
      if (ws) {
        try {
          // T2-31: ws.close() is now async; await to ensure the browser
          // has actually released the handle before we let the original
          // error reach the caller. Pre-T2-31 this returned void with a
          // detached promise — the caller could see "connect failed"
          // and immediately retry while the browser was still releasing
          // the prior port, racing the new permission request.
          await ws.close();
        } catch {
          /* close itself can fail if the port never opened; ignore so the
             original error reaches the caller */
        }
      }
      if (this.portRef.current === ws) {
        this.portRef.current = null;
      }
      try {
        await this.controllerRef.current.disconnect();
      } catch {
        /* the controller may not be in a disconnectable state — fine */
      }
      connectError = err;
      activeConnectReject(err);
      throw err;
    } finally {
      if (connectError === undefined) {
        activeConnectResolve();
      }
      signal?.removeEventListener('abort', forwardExternalAbort);
      if (this._activeConnectAbortController === connectAbortController) {
        this._activeConnectAbortController = null;
      }
      if (this._activeConnectPromise === activeConnect) {
        this._activeConnectPromise = null;
      }
    }
  }

  async disconnect(): Promise<SafetyActionResult> {
    const ctrl = this.controllerRef.current;
    // T1-169 (audit F-013): capture the port at entry so the finally
    // clause only nulls it if it's still the same reference. Pre-T1-169
    // a rapid disconnect → connect race could leave the finally
    // nulling the new port. `connectRealLaser` already used this
    // compare-and-swap pattern (`if (this.portRef.current === ws)`);
    // disconnect / emergencyStop now follow suit.
    const port = this.portRef.current;
    // T1-175 (external audit Critical #3): capture whether a job was
    // running BEFORE we mutate anything. Pre-T1-175 the finally clause
    // unconditionally called `clearUnsafePriorState()` based on the
    // T1-29 reasoning "user-initiated disconnect is a clean shutdown
    // path." The audit pushed back: a user-initiated disconnect while
    // a job is streaming IS qualitatively different from a renderer
    // crash, BUT clicking disconnect doesn't make the physical state
    // safe — the workpiece is partly burnt, the head is at an
    // intermediate position, the material may need inspection. The
    // safer contract: if a job was running at disconnect time, the
    // recovery flag survives to the next launch so the user is
    // prompted to inspect before reusing the setup.
    const wasJobRunning = ctrl?.isJobRunning === true;
    const gatedResult = ctrl ? await this._guardDisconnectStopsJob(ctrl) : null;
    if (gatedResult) return gatedResult;

    let result = makeDisconnectResult();
    try {
      if (ctrl) {
        // T1-164 (audit F-011): route the disconnect-time laserOff
        // outcome through notifyLaserSafetyOutcome so the safety-state
        // machine sees the attempt. Pre-T1-164 the try/catch swallowed
        // both success and failure — a transport-failure laserOff
        // during disconnect couldn't escalate _laserOutputState to
        // 'unknown', and a successful M5 couldn't downgrade it to
        // 'off'. The audit notes the comment ("not connected, buffer
        // full, or port already gone") was misleading: only the first
        // is safe to swallow; the others are real safety events that
        // must reach notifyLaserSafetyOutcome('failed') so the next
        // job-start is gated until the user re-resolves the safe state.
        let stage: 'm5' | 'soft-reset' | 'failed' = 'failed';
        let safeToSwallow = false;
        try {
          const laserResult = await ctrl.operations.laserOff();
          if (laserResult.ok) {
            stage = 'm5';
          } else {
            // operations.laserOff() converts safetyOff().stage into
            // OperationResult.reason. The kind passes through verbatim,
            // so 'soft-reset' / 'failed' map straight back.
            stage = laserResult.reason === 'soft-reset' ? 'soft-reset' : 'failed';
            // "Not connected" is the one swallowable case the audit
            // calls out: the controller never had a live port we could
            // have left in a laser-on state. Anything else (buffer
            // full, port closed mid-flight, soft-reset fallback) is a
            // real safety event.
            const msg = laserResult.message ?? '';
            if (stage === 'failed' && /Not connected/i.test(msg)) {
              safeToSwallow = true;
            }
          }
        } catch (err: unknown) {
          // operations.laserOff() shouldn't throw under normal flow
          // (it returns OperationResult), but if the underlying safetyOff
          // throws synchronously we still want a 'failed' notify unless
          // it's the "Not connected" case.
          const msg = err instanceof Error ? err.message : String(err);
          if (/Not connected/i.test(msg)) {
            safeToSwallow = true;
          }
          stage = 'failed';
        }
        if (!safeToSwallow) {
          this.notifyLaserSafetyOutcome(stage);
        }
        try {
          await ctrl.disconnect();
        } catch (err: unknown) {
          result = makeDisconnectResult({
            accepted: false,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        result = makeNotConnectedResult('disconnectSafe');
      }
    } finally {
      // T1-169 (audit F-013): compare-and-swap to avoid nulling a
      // port reference that a racing fresh connect just installed.
      if (this.portRef.current === port) {
        this.portRef.current = null;
      }
      // T1-171 (audit F-014): tear down the auto-M5-on-connect
      // listener if it's still armed. Without this, a force-
      // disconnect before the controller reaches 'idle' leaks one
      // onStateChange closure per cycle.
      this._clearAutoM5Listener();
      this.clearJobSession();
      // T1-41: invalidate saved-origin G54 snapshot on disconnect.
      // Firmware can lose G54 across power cycles, and a reconnect may
      // run `applyWcsNormalization` which zeros G54. The snapshot from
      // the previous session is no longer trustworthy — force a fresh
      // Set Origin before any saved-origin job.
      this._savedOriginG54Snapshot = null;
      // T1-29 + T1-175 (external audit Critical #3): clear the
      // recovery flag only when no job was streaming at disconnect
      // time. Pre-T1-175 the call was unconditional; the audit
      // flagged this as Critical because a user-initiated disconnect
      // during a burn leaves the workpiece partly burnt and the head
      // at an intermediate position — the physical state may need
      // inspection even though the click was intentional. The T1-29
      // "clean shutdown" semantics still apply to the common case
      // (user disconnects from idle / finished machine): if no job
      // was running, there's no recovery dialog to suppress, so the
      // clear preserves the pre-T1-175 behavior for that path.
      if (!wasJobRunning) {
        clearUnsafePriorState();
      } else {
        // Audit-grade signal: a job was streaming when the user
        // clicked disconnect. The unsafe-prior-state flag survives
        // so the next launch surfaces a recovery dialog before
        // allowing further machine commands.
        console.warn(
          '[MachineService] T1-175: disconnect while job was running. '
          + 'Preserving unsafe-prior-state flag so the next launch '
          + 'surfaces a recovery dialog before further machine commands.',
        );
        // T1-195: also write to the persistent ledger so support
        // bundles capture the event across renderer crashes.
        getMachineEventLedger().append({
          kind: 'disconnect-while-running',
          t: Date.now(),
          ticketId: this.activeTicket?.ticketId ?? null,
        });
      }
    }
    return this._recordSafetyResult(result);
  }

  private async _guardDisconnectStopsJob(ctrl: LaserController): Promise<SafetyActionResult | null> {
    // T3-60: GRBL is host-streamed, so disconnecting the port stops the line
    // stream. Uploaded-file/native controllers may continue running after the
    // host disappears, so a running job must be aborted before closing.
    if (!ctrl.isJobRunning) return null;
    const disconnectStopsJob = controllerDisconnectStopsJob(ctrl);
    if (disconnectStopsJob === true) return null;

    const abortJob = (ctrl as DisconnectSafetyAwareController).safetyOps?.abortJob;
    if (!abortJob) {
      return this._recordSafetyResult(makeDisconnectResult({
        accepted: false,
        message:
          'Cannot safely disconnect: controller may continue running after disconnect ' +
          'and no native abort is available. Inspect machine before retry.',
      }));
    }

    try {
      const abortResult = await abortJob('urgent');
      if (abortResult.accepted) return null;
      return this._recordSafetyResult(makeDisconnectResult({
        accepted: false,
        message: `Cannot safely disconnect: ${abortResult.message ?? 'job stop failed'}. Inspect machine before retry.`,
      }));
    } catch (err: unknown) {
      return this._recordSafetyResult(makeDisconnectResult({
        accepted: false,
        message: `Cannot safely disconnect: ${err instanceof Error ? err.message : String(err)}. Inspect machine before retry.`,
      }));
    }
  }

  async emergencyStop(): Promise<SafetyActionResult> {
    const ctrl = this.controllerRef.current;
    // T1-169 (audit F-013): compare-and-swap pattern — capture the
    // port at entry and only null it if still the same reference.
    const port = this.portRef.current;
    let result = makeEmergencyStopResult();
    try {
      if (ctrl) {
        const operationResult = await ctrl.operations.emergencyStop('MachineService.emergencyStop');
        if (!operationResult.ok) throw new Error(operationResult.reason);
      } else {
        result = makeNotConnectedResult('emergencyStop');
      }
    } catch (err: unknown) {
      result = makeEmergencyStopResult({
        accepted: false,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      // T1-169 (audit F-013): only null if the port reference still
      // matches what we captured at entry. Defends against a racing
      // fresh connect that landed between operations.emergencyStop()
      // and the finally clause.
      if (this.portRef.current === port) {
        this.portRef.current = null;
      }
      // T1-171 (audit F-014): tear down the auto-M5-on-connect
      // listener if it's still armed. Same rationale as in disconnect()
      // — emergencyStop is one of the paths that can force a
      // controller into a non-idle terminal state without ever
      // reporting 'idle'.
      this._clearAutoM5Listener();
      this.clearJobSession();
      this._savedOriginG54Snapshot = null;
      // T1-175 (external audit Critical #2): emergencyStop must NOT
      // clear the unsafe-prior-state flag. Pre-T1-175 the call was
      // unconditional; the audit flagged this as Critical because
      // emergency stop is by definition an unsafe physical
      // interruption: the user pressed E-stop during a burn (or some
      // automated path triggered it for a safety reason), the laser
      // was forced off, the head may be at an intermediate position,
      // the workpiece may be partially burnt. Clearing the recovery
      // flag here means the next launch wouldn't surface a recovery
      // dialog — exactly the case the flag exists for. The flag
      // survives until the user explicitly acknowledges recovery
      // via the App.tsx startup dialog (T1-29 path 3).
      // T1-195: append to the persistent ledger so support bundles
      // capture every emergency-stop event.
      getMachineEventLedger().append({
        kind: 'emergency-stop',
        t: Date.now(),
        accepted: result.accepted,
        message: result.message,
      });
      console.warn(
        '[MachineService] T1-175: emergencyStop preserves unsafe-'
        + 'prior-state flag. Next launch will surface a recovery '
        + 'dialog before further machine commands.',
      );
    }
    return this._recordSafetyResult(result);
  }

  // T1-41: snapshot G54 captured at Set Origin time. Caller is App.tsx's
  // handleSaveOrigin, which fetches the live G54 via the controller and
  // stores it here. Setting `null` invalidates the snapshot — the verify
  // path will then block any saved-origin job until the user re-runs
  // Set Origin.
  setSavedOriginG54Snapshot(g54: { x: number; y: number; z: number } | null): void {
    this._savedOriginG54Snapshot = g54;
  }

  // T1-41: read the snapshot for diagnostics / UI display. The verify
  // path compares this to a freshly-queried G54 at job-start time.
  getSavedOriginG54Snapshot(): { x: number; y: number; z: number } | null {
    return this._savedOriginG54Snapshot;
  }

  // T1-41: query the controller's `$#` and resolve with the freshly-parsed
  // G54 work offset. Used at Set Origin (capture) and job start (verify).
  // Returns `null` if the controller isn't connected or doesn't implement
  // `requestWorkOffsets` (non-GRBL controllers — when those land, they'll
  // need their own equivalent).
  async requestWorkOffsets(timeoutMs?: number): Promise<{ x: number; y: number; z: number } | null> {
    const ctrl = this.controllerRef.current;
    if (!ctrl || typeof ctrl.requestWorkOffsets !== 'function') return null;
    return ctrl.requestWorkOffsets(timeoutMs);
  }

  /**
   * Classify user-typed console input only. Caller shows confirm dialogs and
   * only sends after the user approves; this method does not prompt.
   */
  classifyUserCommand(command: string): CommandClassification {
    return classifyUserCommand(command);
  }

  requestApproval(command: string): ApprovalToken | null {
    const classification = classifyUserCommand(command);
    if (classification.severity === 'safe') return null;

    const now = Date.now();
    this.pruneConsumedApprovalNonces(now);
    return {
      command: classification.command,
      issuedAt: now,
      expiresAt: now + APPROVAL_TOKEN_TTL_MS,
      classification: classification.severity,
      nonce: createApprovalNonce(),
    };
  }

  // T1-136: delegates to pure pruneApprovalNonceStore. The helper
  // owns the TTL + FIFO-cap rules; this method now exists only so
  // existing callers (MachineCommandGateway passes a callback to it)
  // keep working unchanged.
  private pruneConsumedApprovalNonces(now = Date.now()): void {
    pruneApprovalNonceStore(this.consumedApprovalNonces, now, MAX_CONSUMED_APPROVAL_NONCES);
  }

  /**
   * Forward a line to GRBL.
   *
   * Internal LaserForge callers (frame, jog, autofocus, etc.) pass
   * `source: 'internal'` and bypass classification — the framework owns
   * those calls and they're already gated by their respective service
   * methods.
   *
   * User-typed lines from the console pass `source: 'user'`. The service
   * classifies the line via {@link classifyUserCommand} (the same
   * classifier the UI uses to drive confirm dialogs) and rejects warn /
   * dangerous lines that don't carry a single-use approval token from
   * {@link requestApproval}.
   *
   * The UI flow:
   *   1. Call `classifyUserCommand(cmd)` → get severity.
   *   2. If safe, call `sendCommand(cmd, 'user')`.
   *   3. If warn or dangerous, show confirm dialog. On approval, mint
   *      `const token = requestApproval(cmd)` and call
   *      `sendCommand(cmd, 'user', token)`. On rejection, do not send.
   *
   * The point of the service-layer gate is defense in depth (T1-6).
   * If a future caller — a script panel, an MCP tool, an automation,
   * a developer console misuse — calls `sendCommand(cmd, 'user')`
   * without going through the UI confirm flow, dangerous commands are
   * rejected with a thrown error rather than silently executed. The UI
   * remains the primary gate; this is the wall behind the first wall.
   *
   * Throws `Error` with `code: 'COMMAND_BLOCKED'` and structured
   * `severity` / `reason` / `command` / `blockReason` properties when
   * a user line is blocked.
   */
  async sendCommand(
    command: string,
    source: 'internal' | 'user' = 'internal',
    approvalToken?: ApprovalToken,
  ): Promise<void> {
    const classification =
      source === 'user' ? classifyUserCommand(command) : null;
    new MachineCommandGateway(this.controllerRef.current).sendCommand(command, source, approvalToken, {
      consumedApprovalNonces: this.consumedApprovalNonces,
      pruneConsumedApprovalNonces: (now: number) => this.pruneConsumedApprovalNonces(now),
    });
    // T3-37: a user-approved raw console G10 or G92 changes the coordinate
    // frame outside the tracked Set Origin flow. Clear the saved-origin G54
    // snapshot only after the command passes the approval gate and reaches
    // the controller; blocked commands should not invalidate trusted state.
    if (classification && mutatesWorkCoordinateSystem(classification.command)) {
      this._savedOriginG54Snapshot = null;
    }
  }

  async autoFocus(): Promise<{ ok: true } | { ok: false; error: string }> {
    const profile = getActiveProfile();
    if (!profile?.autoFocusSupported) {
      return { ok: false, error: 'Autofocus not supported on this machine' };
    }
    if (!profile.autoFocusCommand || profile.autoFocusCommand.trim().length === 0) {
      return { ok: false, error: 'Autofocus not supported on this machine' };
    }
    if (!this.controllerRef.current) {
      return { ok: false, error: 'Not connected' };
    }
    if (typeof this.controllerRef.current.runAutoFocus !== 'function') {
      return { ok: false, error: 'Autofocus not supported on this controller' };
    }

    const timeoutMs =
      Number.isFinite(profile.autoFocusTimeoutMs) && (profile.autoFocusTimeoutMs ?? 0) > 0
        ? profile.autoFocusTimeoutMs!
        : 15_000;

    try {
      await this.controllerRef.current.runAutoFocus(profile.autoFocusCommand, timeoutMs);
      return { ok: true };
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Autofocus failed',
      };
    }
  }

  async jog(axis: 'X' | 'Y', distance: number, feedRate: number): Promise<{ ok: boolean; reason?: string }> {
    const ctrl = this.controllerRef.current;
    if (!ctrl) return { ok: false, reason: 'no-controller' };
    // T1-221 (v30 audit #9, bypass plug): acquire the operation
    // mutex for the duration of the jog. Pre-T1-221 this method
    // skipped the mutex entirely — `ExecutionCoordinator.jog`
    // acquired it, but a future UI path / test harness calling
    // `MachineService.jog` directly could interleave with an
    // active test-fire / frame-dot / autoFocus operation (all of
    // which issue motion + modal commands that would race on
    // GRBL's command queue).
    // T1-222 (v30 audit #9, lease tokens): release via the lease so a
    // stale-round release cannot clear a fresh same-kind session.
    const lease = this.tryAcquireOperation('jog');
    if (lease == null) {
      return { ok: false, reason: 'operation-busy' };
    }
    try {
      try {
        const result = await ctrl.operations.jog({ axis, distanceMm: distance, feedMmPerMin: feedRate });
        if (!result.ok) return { ok: false, reason: result.reason };
      } catch (err: unknown) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
      setTimeout(() => {
        try {
          this.controllerRef.current.requestStatusReport();
        } catch {
          /* ignore */
        }
      }, 100);
      return { ok: true };
    } finally {
      this.releaseOperation(lease);
    }
  }

  /** Pause the currently running job (feed-hold). */
  async pause(): Promise<SafetyActionResult> {
    // T1-200: record every user pause request even before we know
    // whether the controller is connected. Support bundles use the
    // (pause-requested, paused-verified) pair to detect dropped pauses
    // — a request without a matching verification means feed-hold
    // didn't take, which is a safety-relevant event.
    getMachineEventLedger().append({ kind: 'pause-requested', t: Date.now() });
    const ctrl = this.controllerRef.current;
    if (!ctrl) return this._recordSafetyResult(makeNotConnectedResult('pause'));
    try {
      const result = await ctrl.operations.pauseJob();
      if (!result.ok) throw new Error(result.reason);
      // T1-200: paused-verified fires only after the controller
      // confirms the operation succeeded. A throw between this and
      // the catch leaves a pause-requested without a paused-verified
      // — that asymmetry is the diagnostic signal.
      getMachineEventLedger().append({ kind: 'paused-verified', t: Date.now() });
      return this._recordSafetyResult(makePauseResult());
    } catch (err: unknown) {
      return this._recordSafetyResult({
        ...makeNotConnectedResult('pause'),
        requiresReconnect: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Resume a paused job. */
  async resume(): Promise<SafetyActionResult> {
    // T1-200: record every user resume request. Resume has no
    // "verified" counterpart in the MachineEvent union (the
    // observability bar is lower than pause — a missed resume just
    // means the job stays paused, which is the safe default). A
    // future expansion could add 'resume-verified' if needed.
    getMachineEventLedger().append({ kind: 'resume-requested', t: Date.now() });
    const ctrl = this.controllerRef.current;
    if (!ctrl) return this._recordSafetyResult(makeNotConnectedResult('resume'));
    try {
      const result = await ctrl.operations.resumeJob();
      if (!result.ok) throw new Error(result.reason);
      return this._recordSafetyResult(makeResumeResult());
    } catch (err: unknown) {
      return this._recordSafetyResult({
        ...makeNotConnectedResult('resume'),
        requiresReconnect: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * T2-41: returns a structured `SafetyActionResult` describing the
   * outcome — for audit trail (T2-46), recovery-dialog gating (e.g.
   * `requiresRehome: true` disables Start until $H runs), and
   * future state-machine integration (T2-44). Pre-T2-41 the return
   * was `Promise<void>` so callers couldn't tell whether stop was
   * accepted, whether position was invalidated, or what to surface
   * to the user. GRBL's `stop()` sends a realtime soft-reset; the
   * shape `makeSoftResetStopResult()` describes the semantics:
   * laser commandedOff, position lost, rehome required.
   */
  async stopAndEnsureLaserOff(sendTx?: (line: string) => void): Promise<SafetyActionResult> {
    const result = await this.controllerRef.current.operations.stopJob(undefined, 'stopAndEnsureLaserOff');
    if (!result.ok) throw new Error(result.reason);
    // The controller stop operation handles laser-off as part of its reset/abort sequence.
    // M5 via sendCommand would race the reset and usually throw
    // 'Not connected' anyway. Intentionally no follow-up writes here.
    void sendTx;
    return this._recordSafetyResult(makeSoftResetStopResult());
  }
}
