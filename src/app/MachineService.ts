import { type MutableRefObject } from 'react';
import { type LaserController } from '../controllers/ControllerInterface';
import { type SerialPortLike } from '../communication/SerialPort';
import { WebSerialPort } from '../communication/WebSerialPort';
import { createSerialPort } from '../communication/SerialPortFactory';
import { type MachineState, type JobProgress } from '../controllers/ControllerInterface';
import { type Scene } from '../core/scene/Scene';
import { hasPro } from '../entitlements';
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
import {
  classifyUserCommand as classifyUserGrbl,
  type CommandClassification,
} from '../controllers/grbl/CommandClassifier';

export interface BurnState {
  readonly activeIds: ReadonlySet<string>;
  readonly burnedIds: ReadonlySet<string>;
}

export type BurnStateListener = (state: BurnState) => void;

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

  private detachRecording: (() => void) | null = null;

  constructor(
    private readonly controllerRef: MutableRefObject<LaserController>,
    private readonly portRef: MutableRefObject<SerialPortLike | null>,
  ) {}

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
    this.activeReplay = null;
    this.currentJobLog = null;
    this.activeTicket = null;
  }

  /** Read-only accessor — tests and future phases need to inspect
   *  which ticket is running. */
  getActiveTicket(): ValidatedJobTicket | null {
    return this.activeTicket;
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
  tryFinalizeJobLog(
    machineState: MachineState | null,
    jobProgress: JobProgress | null,
    isJobRunning: boolean,
    appendMessage: (msg: string) => void,
  ): void {
    const log = this.currentJobLog;
    if (!log || log.status !== 'running') return;

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
    const saveResult = saveJobLog(log);
    if (saveResult.ok) {
      if (saveResult.message) {
        appendMessage(`\u26A0 ${saveResult.message}`);
      } else {
        appendMessage(`\u2713 Job log saved (${status})`);
      }
    } else {
      appendMessage(`\u26A0 ${saveResult.message ?? 'Job log not saved'}`);
    }
    this.currentJobLog = null;
    this.activeTicket = null;
  }

  async beginJobRun(args: {
    lines: string[];
    scene: Scene;
    machineState: MachineState | null;
    gcodeText: string;
    notifySimulatorTx: (line: string) => void;
  }): Promise<void> {
    const { lines, scene, machineState, gcodeText, notifySimulatorTx } = args;

    this.burnState = emptyBurnState();
    this.emitBurnState();

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
    addLogEntry(jobLog, 'milestone', `Job started: ${lines.length} commands`);
    this.currentJobLog = jobLog;

    if (hasPro()) {
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
    } else {
      this.activeReplay = null;
    }

    for (const line of lines) notifySimulatorTx(line);
    await this.controllerRef.current.sendJob(lines);
  }

  /** Start a job from a validated ticket. The ticket carries the
   *  gcode lines and metadata; we stash it for later phases that
   *  will verify scene/profile hashes before streaming. This phase
   *  is a parallel entry point — same side effects as beginJobRun,
   *  just ticket-shaped inputs. */
  async startValidatedJob(args: {
    ticket: ValidatedJobTicket;
    scene: Scene;
    machineState: MachineState | null;
    notifySimulatorTx: (line: string) => void;
  }): Promise<void> {
    const { ticket, scene, machineState, notifySimulatorTx } = args;

    this.activeTicket = ticket;

    this.burnState = emptyBurnState();
    this.emitBurnState();

    const lines = [...ticket.gcodeLines];
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

    if (hasPro()) {
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
    } else {
      this.activeReplay = null;
    }

    for (const line of lines) notifySimulatorTx(line);
    await this.controllerRef.current.sendJob(lines);
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

  async connectRealLaser(baudRate: number): Promise<void> {
    if (!WebSerialPort.isSupported()) {
      throw new Error('Web Serial not supported in this browser');
    }
    const ws = createSerialPort('web') as WebSerialPort;
    this.portRef.current = ws;
    await ws.requestAndOpen(baudRate);
    await this.controllerRef.current.connect(ws);
    this.state.isSimulator = false;
  }

  async disconnect(): Promise<void> {
    await this.controllerRef.current.disconnect();
    this.portRef.current = null;
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
