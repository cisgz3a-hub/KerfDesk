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
import { getActiveProfile } from '../core/devices/DeviceProfile';
import { type ValidatedJobTicket } from '../core/job/ValidatedJobTicket';
import { type ActiveJobCanvasContext } from './ActiveJobCanvasContext';
import { hashObject, hashSceneForTicket, hashString } from '../core/job/ticketHashing';
import { type ControllerId } from '../controllers/ControllerRegistry';
import {
  classifyUserCommand as classifyUserGrbl,
  type CommandClassification,
} from '../controllers/grbl/CommandClassifier';

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

export class MachineService {
  private state: MachineServiceState = {
    isSimulator: false,
    messages: [],
  };

  private burnState: BurnState = emptyBurnState();
  private burnStateListeners = new Set<BurnStateListener>();

  private activeReplay: JobReplay | null = null;
  private currentJobLog: JobLog | null = null;

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

  /** T2-12 part 1: subscribers to laser-output-state transitions. */
  private _laserOutputStateListeners: Set<(state: LaserOutputState) => void> = new Set();

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
      console.warn('[ticket] scene hash mismatch', {
        ticketHash: ticket.sceneHash,
        currentHash: currentSceneHash,
        ticketScenePreview: JSON.stringify(ticket).slice(0, 500),
      });
      return {
        ok: false,
        reason:
          'Scene has changed since this job was compiled. Recompile to continue. '
          + `(ticket scene hash ${ticket.sceneHash}, current ${currentSceneHash})`,
      };
    }

    const currentProfile = getActiveProfile();
    const currentProfileHash = currentProfile
      ? hashObject(currentProfile)
      : hashString('no-profile');
    if (currentProfileHash !== ticket.profileHash) {
      return {
        ok: false,
        reason:
          'Device profile has changed since this job was compiled. Recompile to continue. '
          + `(ticket profile hash ${ticket.profileHash}, current ${currentProfileHash})`,
      };
    }

    const currentControllerType: ControllerId = 'grbl';
    if (currentControllerType !== ticket.controllerType) {
      return {
        ok: false,
        reason:
          'Controller type has changed since this job was compiled. '
          + `(ticket ${ticket.controllerType}, current ${currentControllerType})`,
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

      for (const line of lines) notifySimulatorTx(line);
      await this.controllerRef.current.sendJob(lines);
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

  async connectRealLaser(baudRate: number): Promise<void> {
    if (!WebSerialPort.isSupported()) {
      throw new Error('Web Serial not supported in this browser');
    }
    const ws = createSerialPort('web') as WebSerialPort;
    this.portRef.current = ws;
    await ws.requestAndOpen(baudRate);
    await this.controllerRef.current.connect(ws);
    this.state.isSimulator = false;
    // T1-22: fresh connection clears any stale unknown laser-safety state
    // from a previous session.
    this._setLaserOutputState('off');
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
    }
  }

  /**
   * Classify user-typed console input only. Caller shows confirm dialogs and
   * only sends after the user approves; this method does not prompt.
   */
  classifyUserCommand(command: string): CommandClassification {
    return classifyUserGrbl(command);
  }

  /**
   * Forward a line to GRBL. Gating of user-typed content is the UI’s job; `user`
   * is passed through to the controller for call-site documentation / future
   * audit, not to block in the service layer.
   */
  async sendCommand(
    command: string,
    source: 'internal' | 'user' = 'internal',
  ): Promise<void> {
    this.controllerRef.current.sendCommand(command, source);
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

  jog(axis: 'X' | 'Y', distance: number, feedRate: number): void {
    const cmd = `$J=G91 G21 ${axis}${distance} F${feedRate}`;
    this.controllerRef.current.sendCommand(cmd, 'internal');
    setTimeout(() => {
      try {
        this.controllerRef.current.requestStatusReport();
      } catch {
        /* ignore */
      }
    }, 100);
  }

  /** Pause the currently running job (feed-hold). */
  pause(): void {
    this.controllerRef.current.pause();
  }

  /** Resume a paused job. */
  resume(): void {
    this.controllerRef.current.resume();
  }

  async stopAndEnsureLaserOff(sendTx?: (line: string) => void): Promise<void> {
    this.controllerRef.current.stop();
    // Soft reset handles laser-off as part of GRBL's reset sequence.
    // M5 via sendCommand would race the reset and usually throw
    // 'Not connected' anyway. Intentionally no follow-up writes here.
    void sendTx;
  }
}
