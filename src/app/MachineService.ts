import { type MutableRefObject } from 'react';
import { type LaserController } from '../controllers/ControllerInterface';
import { type SerialPortLike } from '../communication/SerialPort';
import { WebSerialPort } from '../communication/WebSerialPort';
import { createSerialPort } from '../communication/SerialPortFactory';
import { type MachineState, type JobProgress } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
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
import { type SafetyActionResult, makeSoftResetStopResult } from './SafetyActionResult';
import { getActiveProfile } from '../core/devices/DeviceProfile';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { type ActiveJobCanvasContext } from './ActiveJobCanvasContext';
import { setUnsafePriorState, clearUnsafePriorState } from './unsafePriorState';
import { hashObject, hashSceneForTicket, hashString } from '../core/job/ticketHashing';
import { type ControllerId } from '../controllers/ControllerRegistry';
import {
  classifyUserCommand as classifyUserGrbl,
  type CommandSeverity,
} from '../controllers/grbl/CommandClassifier';
import {
  MachineCommandGateway,
  type ApprovalToken,
} from './MachineCommandGateway';

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

function emptyBurnState(): BurnState {
  return {
    activeIds: new Set<string>(),
    burnedIds: new Set<string>(),
  };
}

export interface MachineServiceState {
  isSimulator: boolean;
  messages: string[];
}

export interface JobRecordingSink {
  appendConsoleLine: (line: string) => void;
  onReplayCompleted: (replay: JobReplay) => void;
}

const APPROVAL_TOKEN_TTL_MS = 30_000;
const MAX_CONSUMED_APPROVAL_NONCES = 512;

function createApprovalNonce(): string {
  const cryptoLike = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return cryptoLike.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class MachineService {
  private state: MachineServiceState = {
    isSimulator: false,
    messages: [],
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
  // T1-41: G54 work offset captured at the time the user clicked Set Origin.
  // The verify path (`verifySavedOrigin`) compares this to a freshly-queried
  // value at job start. `null` means Set Origin was never run this session
  // (or the snapshot was invalidated, e.g. by disconnect).
  private _savedOriginG54Snapshot: { x: number; y: number; z: number } | null = null;

  /** T2-12 part 1: subscribers to laser-output-state transitions. */
  private _laserOutputStateListeners: Set<(state: LaserOutputState) => void> = new Set();

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
    };
  }

  appendMessage(message: string): void {
    this.state.messages = [...this.state.messages, message];
  }

  setMessages(messages: string[]): void {
    this.state.messages = [...messages];
  }

  clearMessages(): void {
    this.state.messages = [];
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
  private validateTicket(
    ticket: ValidatedJobTicket,
    scene: Scene,
  ): { ok: true } | { ok: false; reason: string } {
    const currentSceneHash = hashSceneForTicket(scene);
    if (currentSceneHash !== ticket.sceneHash) {
      // T1-67: hashes stay in diagnostics, not in user-facing modal text.
      console.warn('[ticket] scene hash mismatch', {
        ticketHash: ticket.sceneHash,
        currentHash: currentSceneHash,
        ticketScenePreview: JSON.stringify(ticket).slice(0, 500),
      });
      return {
        ok: false,
        reason:
          'The design changed after this G-code was created. '
          + 'Update G-code, then frame again before starting.',
      };
    }

    const currentProfile = getActiveProfile();
    const currentProfileHash = currentProfile
      ? hashObject(currentProfile)
      : hashString('no-profile');
    if (currentProfileHash !== ticket.profileHash) {
      console.warn('[ticket] profile hash mismatch', {
        ticketHash: ticket.profileHash,
        currentHash: currentProfileHash,
      });
      return {
        ok: false,
        reason:
          'The device profile changed after this G-code was created. '
          + 'Update G-code before starting.',
      };
    }

    const currentControllerType: ControllerId = 'grbl';
    if (currentControllerType !== ticket.controllerType) {
      console.warn('[ticket] controller type mismatch', {
        ticketControllerType: ticket.controllerType,
        currentControllerType,
      });
      return {
        ok: false,
        reason:
          'The controller type changed after this G-code was created. '
          + 'Update G-code before starting.',
      };
    }

    const recomputedGcodeHash = hashString(ticket.gcodeText);
    if (recomputedGcodeHash !== ticket.gcodeHash) {
      return {
        ok: false,
        reason: 'Ticket is corrupted (gcode hash mismatch). Recompile to continue.',
      };
    }

    return { ok: true };
  }

  async startValidatedJob(args: {
    ticket: ValidatedJobTicket;
    scene: Scene;
    machineState: MachineState | null;
    notifySimulatorTx: (line: string) => void;
    canvasContext: ActiveJobCanvasContext;
  }): Promise<void> {
    const { ticket, scene, machineState, notifySimulatorTx, canvasContext } = args;

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

    const validation = this.validateTicket(ticket, scene);
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

      // T1-46: kick off sendJob FIRST so the controller starts streaming
      // immediately; defer the simulator-fan-out loop to a chunked
      // setTimeout. notifySimulatorTx fans out to UI listeners (progress
      // overlays, replay capture mirror); doing 2M synchronous calls
      // before sendJob meant the controller didn't see byte 1 until
      // after the entire fan-out completed — multi-second freeze right
      // when the user expects "click Start → laser begins" within
      // ~100ms. Chunking yields between batches so the browser can
      // repaint and the controller's streaming continues uninterrupted.
      // Errors from individual notify callbacks are swallowed (matches
      // the existing per-callback try/catch in notifySimulatorTx) — a
      // broken listener mustn't take down job start. sendJob's own
      // promise carries the streaming/transport error contract.
      const sendPromise = this.controllerRef.current.sendJob(lines);
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

        this.activeReplay = null;
        this.currentJobLog = null;
        this.activeTicket = null;
        this.activeJobCanvasContext = null;
        this.jobObservedRunning = false;
        this.activeJobSessionId = null;
        void this.releaseWakeLock();
        // T1-29: a failed-start counts as a clean shutdown for the
        // unsafe-prior-state flag — the job never reached "running" so
        // there's no in-flight burn to recover from. The error already
        // surfaced to the caller; the recovery dialog on next launch
        // would be a confusing duplicate. T2-67's job log/replay
        // capture + 'failed_to_start' status carries the diagnostic
        // record forward.
        clearUnsafePriorState();
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
   * T2-11: try to acquire the operation mutex for `kind`. Returns true on
   * success (caller now holds the mutex), false if another kind is
   * already active. Same-kind re-acquire returns true without changing
   * `startedAt` / `sessionId` — preserves the test-fire deadman re-entry
   * pattern where a second `beginTestFire` cancels the existing timer
   * and re-arms it without bouncing through release/acquire.
   *
   * Failure modes returned as `false`:
   *   - A different operation is currently active (e.g. test-fire is
   *     held; caller asked for frame-dot).
   *
   * Caller MUST pair every successful acquire with exactly one
   * {@link releaseOperation} call (try/finally is the right shape for
   * synchronous and async operations alike). Same-kind re-acquire still
   * counts as one acquire — release once is sufficient.
   */
  tryAcquireOperation(kind: ActiveOperationKind): boolean {
    if (this._activeOperation == null) {
      this._activeOperation = {
        kind,
        startedAt: Date.now(),
        sessionId: ++this._operationSessionCounter,
      };
      return true;
    }
    if (this._activeOperation.kind === kind) {
      return true;
    }
    return false;
  }

  /**
   * T2-11: release the operation mutex if currently held by `kind`.
   * Idempotent — calling release for a kind that's not held is a no-op
   * and does NOT disturb a different kind that may be active. A warn is
   * emitted on a kind-mismatch (caller is releasing the wrong kind),
   * because that almost certainly means a try/finally pair is wrong.
   */
  releaseOperation(kind: ActiveOperationKind): void {
    if (this._activeOperation == null) return;
    if (this._activeOperation.kind !== kind) {
      console.warn(
        `[T2-11] releaseOperation('${kind}') called while '${this._activeOperation.kind}' is active; ignoring`,
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
    const tick = (): void => {
      const end = Math.min(idx + NOTIFY_CHUNK, lines.length);
      for (; idx < end; idx++) {
        try {
          notify(lines[idx]);
        } catch {
          /* ignore — broken listener must not break the chunked loop */
        }
      }
      if (idx < lines.length) {
        setTimeout(tick, 0);
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
    if (stage === 'm5') {
      this._setLaserOutputState('off');
    } else {
      // soft-reset or failed — treat both as uncertain. Soft reset disables
      // laser output at firmware level, but the M5-path indeterminacy means
      // the planner state is unknown and a fresh connection check is the
      // safest reset.
      this._setLaserOutputState('unknown');
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

  async connectRealLaser(baudRate: number, signal?: AbortSignal): Promise<void> {
    // T1-50 Part B: accept an optional AbortSignal. The spec's full
    // shape — propagating the signal through `WebSerialPort.requestAndOpen`
    // and `GrblController.connect` so an in-flight open or handshake
    // can be cancelled mid-air — needs API changes inside those classes
    // and is filed as T2-32 / T2-33. For T1-50 we ship the interface
    // stub plus `throwIfAborted` hooks at every await point: a caller
    // that already aborted before calling, or that aborts during one
    // of the underlying async steps, observes the throw at the next
    // await boundary and triggers the T1-49 cleanup path. No
    // production caller passes a signal yet, so this has zero
    // behavioral effect today; future ConnectionManager work (T2-32)
    // will plumb a real signal through.
    signal?.throwIfAborted();
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
    let ws: WebSerialPort | null = null;
    try {
      ws = createSerialPort('web') as WebSerialPort;
      await ws.requestAndOpen(baudRate);
      signal?.throwIfAborted();
      await this.controllerRef.current.connect(ws);
      signal?.throwIfAborted();
      this.portRef.current = ws;
      this.state.isSimulator = false;
      // T1-22: fresh connection clears any stale unknown laser-safety state
      // from a previous session.
      this._setLaserOutputState('off');
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
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    const ctrl = this.controllerRef.current;
    try {
      if (ctrl) {
        try {
          ctrl.sendCommand('M5 S0', 'internal');
        } catch {
          /* not connected, buffer full, or port already gone */
        }
        await ctrl.disconnect();
      }
    } finally {
      this.portRef.current = null;
      this.clearJobSession();
      // T1-41: invalidate saved-origin G54 snapshot on disconnect.
      // Firmware can lose G54 across power cycles, and a reconnect may
      // run `applyWcsNormalization` which zeros G54. The snapshot from
      // the previous session is no longer trustworthy — force a fresh
      // Set Origin before any saved-origin job.
      this._savedOriginG54Snapshot = null;
      // T1-29: user-initiated disconnect is a clean shutdown path.
      // Service ran M5 S0 + controller disconnect above; the job, if
      // any was active, is being intentionally stopped. Clear the
      // flag so the next launch doesn't surface the recovery dialog.
      // Disconnect-while-job-runs IS the user explicitly halting the
      // burn; that's qualitatively different from a renderer crash.
      clearUnsafePriorState();
    }
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
    return classifyUserGrbl(command);
  }

  requestApproval(command: string): ApprovalToken | null {
    const classification = classifyUserGrbl(command);
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

  private pruneConsumedApprovalNonces(now = Date.now()): void {
    for (const [nonce, expiresAt] of this.consumedApprovalNonces) {
      if (expiresAt <= now) {
        this.consumedApprovalNonces.delete(nonce);
      }
    }

    while (this.consumedApprovalNonces.size > MAX_CONSUMED_APPROVAL_NONCES) {
      const oldest = this.consumedApprovalNonces.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.consumedApprovalNonces.delete(oldest);
    }
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
    new MachineCommandGateway(this.controllerRef.current).sendCommand(command, source, approvalToken, {
      consumedApprovalNonces: this.consumedApprovalNonces,
      pruneConsumedApprovalNonces: (now: number) => this.pruneConsumedApprovalNonces(now),
    });
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

  jog(axis: 'X' | 'Y', distance: number, feedRate: number): { ok: boolean; reason?: string } {
    const ctrl = this.controllerRef.current;
    if (!ctrl) return { ok: false, reason: 'no-controller' };
    const cmd = `$J=G91 G21 ${axis}${distance} F${feedRate}`;
    try {
      ctrl.sendCommand(cmd, 'internal');
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
  }

  /** Pause the currently running job (feed-hold). */
  pause(): void {
    this.controllerRef.current.pause();
  }

  /** Resume a paused job. */
  resume(): void {
    this.controllerRef.current.resume();
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
    this.controllerRef.current.stop();
    // Soft reset handles laser-off as part of GRBL's reset sequence.
    // M5 via sendCommand would race the reset and usually throw
    // 'Not connected' anyway. Intentionally no follow-up writes here.
    void sendTx;
    return makeSoftResetStopResult();
  }
}
