import { type MutableRefObject } from 'react';
import { type LaserController } from '../controllers/ControllerInterface';
import { type SerialPortLike } from '../communication/SerialPort';
import { WebSerialPort } from '../communication/WebSerialPort';
import { WebSocketSerialPort } from '../communication/WebSocketSerialPort';
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

  private activeReplay: JobReplay | null = null;
  private currentJobLog: JobLog | null = null;
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

    const unsubRaw = controller.onRawLine((line, dir) => {
      recordingSink.appendConsoleLine(`${dir === 'tx' ? '>' : '<'} ${line}`);
      const r = this.activeReplay;
      if (r && r.status === 'running') {
        addReplayEntry(r, dir === 'tx' ? 'tx' : 'rx', line);
      }
      const jl = this.currentJobLog;
      if (jl && jl.status === 'running') {
        addLogEntry(jl, dir === 'tx' ? 'sent' : 'received', line);
      }
    });

    const cleanup = () => {
      unsubProgress();
      unsubError();
      unsubRaw();
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
    saveJobLog(log);
    appendMessage(`\u2713 Job log saved (${status})`);
    this.currentJobLog = null;
  }

  beginJobRun(args: {
    lines: string[];
    scene: Scene;
    machineState: MachineState | null;
    gcodeText: string;
    notifySimulatorTx: (line: string) => void;
  }): void {
    const { lines, scene, machineState, gcodeText, notifySimulatorTx } = args;

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
    this.controllerRef.current.sendJob(lines);
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

  async connectWifiLaser(host: string, bridgePort: number = 8765): Promise<void> {
    const ws = createSerialPort('websocket') as WebSocketSerialPort;
    const url = `ws://${host}:${bridgePort}`;
    this.portRef.current = ws;
    await ws.connect(url);
    await this.controllerRef.current.connect(ws);
    this.state.isSimulator = false;
  }

  async disconnect(): Promise<void> {
    await this.controllerRef.current.disconnect();
    this.portRef.current = null;
  }

  sendCommand(command: string): void {
    this.controllerRef.current.sendCommand(command);
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
    this.sendCommand(cmd);
    setTimeout(() => {
      try {
        this.controllerRef.current.requestStatusReport();
      } catch {
        /* ignore */
      }
    }, 100);
  }

  pauseResume(paused: boolean): void {
    if (paused) {
      this.controllerRef.current.resume();
    } else {
      this.controllerRef.current.pause();
    }
  }

  async stopAndEnsureLaserOff(sendTx?: (line: string) => void): Promise<void> {
    this.controllerRef.current.stop();
    // Soft reset handles laser-off as part of GRBL's reset sequence.
    // M5 via sendCommand would race the reset and usually throw
    // 'Not connected' anyway. Intentionally no follow-up writes here.
    void sendTx;
  }
}
