import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type GrblController } from '../../controllers/grbl/GrblController';
import { MockSerialPort } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';
import { type Scene } from '../../core/scene/Scene';
import { type LayerMode, type FillMode } from '../../core/scene/Layer';
import { DeviceProfileSelector } from './DeviceProfileSelector';
import { JobLogViewer } from './JobLogViewer';
import { runPreflight, type PreflightResult, type PreflightIssue } from '../../core/preflight/PreflightChecker';
import { createReplay, addReplayEntry, finalizeReplay, saveReplay, type JobReplay } from '../../core/replay/JobReplay';
import {
  createJobLog,
  addLogEntry,
  finalizeLog,
  saveJobLog,
  type JobLog,
} from '../../core/job/JobLog';
import { recordMaterialOutcome } from '../../core/materials/MaterialFeedback';
import { computeGcodeOffset } from '../../core/output/GcodeOrigin';
import { type StartMode } from './StartPositionWizard';
import { SimulatorView } from './SimulatorView';

function formatJobTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function playCompletionBeep(): void {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const audioCtx = new AC();
    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    oscillator.connect(gain);
    gain.connect(audioCtx.destination);

    oscillator.frequency.value = 880;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.setValueAtTime(0, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime + 0.2);
    gain.gain.setValueAtTime(0, audioCtx.currentTime + 0.32);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.4);
  } catch {
    /* Audio not available */
  }
}

interface ConnectionPanelProps {
  controller: GrblController;
  portRef: React.MutableRefObject<WebSerialPort | MockSerialPort | null>;
  machineState: MachineState | null;
  jobProgress: JobProgress | null;
  scene: Scene;
  gcode: string | null;
  bedWidth: number;
  bedHeight: number;
  boundsMinX?: number;
  boundsMinY?: number;
  boundsMaxX?: number;
  boundsMaxY?: number;
  onClose: () => void;
  /** Called after a successful disconnect cleanup so the host can hide the panel */
  onDisconnect?: () => void;
  productionMode?: boolean;
  showAlert: (title: string, message: string, details?: string) => Promise<void>;
  showConfirm: (title: string, message: string, details?: string) => Promise<boolean>;
  showPrompt: (title: string, message: string, defaultValue?: string) => Promise<string | null>;
  onSceneCommit: (scene: Scene) => void;
  startMode: StartMode;
  savedOrigin: { x: number; y: number } | null;
  machinePosition: { x: number; y: number } | null;
  onSelectMode: (mode: StartMode) => void;
  onSaveOrigin: () => void;
  gcodeStale?: boolean;
  onRecompile?: () => void;
  onUpdateLayerMode?: (layerId: string, mode: LayerMode) => void;
  onUpdateLayerFillMode?: (layerId: string, fillMode: FillMode) => void;
  onUpdateLayerFillInterval?: (layerId: string, intervalMm: number) => void;
  onUpdateLayerFillBidirectional?: (layerId: string, bidirectional: boolean) => void;
}

export function ConnectionPanel({
  controller,
  portRef,
  machineState,
  jobProgress,
  scene,
  gcode,
  bedWidth,
  bedHeight,
  boundsMinX,
  boundsMinY,
  boundsMaxX,
  boundsMaxY,
  onClose,
  onDisconnect,
  productionMode = false,
  showAlert,
  showConfirm,
  showPrompt,
  onSceneCommit,
  startMode,
  savedOrigin,
  machinePosition,
  onSelectMode,
  onSaveOrigin,
  gcodeStale = false,
  onRecompile,
  onUpdateLayerMode,
  onUpdateLayerFillMode,
  onUpdateLayerFillInterval,
  onUpdateLayerFillBidirectional,
}: ConnectionPanelProps) {
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSimulator, setIsSimulator] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [jogStep, setJogStep] = useState(10);
  const [showMore, setShowMore] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [manualCmd, setManualCmd] = useState('');
  const [currentReplay, setCurrentReplay] = useState<JobReplay | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);
  const [currentLog, setCurrentLog] = useState<JobLog | null>(null);
  const [isTestFiring, setIsTestFiring] = useState(false);
  const isTestFiringRef = useRef(false);
  const testFireTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [completedTime, setCompletedTime] = useState(0);
  const [progressFlashGreen, setProgressFlashGreen] = useState(false);

  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const logRef = useRef<HTMLDivElement>(null);
  /** Same object as currentReplay while a job is recording; set before sendJob so sync TX callbacks see it */
  const activeReplayRef = useRef<JobReplay | null>(null);
  const currentLogRef = useRef<JobLog | null>(null);
  const simulatorListenersRef = useRef(new Set<(line: string) => void>());
  const jobStartTimeRef = useRef<number | null>(null);
  const jobProgressRef = useRef<JobProgress | null>(null);
  const elapsedSecondsRef = useRef(0);
  const jobStoppedByUserRef = useRef(false);
  const hasZeroed = useRef(false);
  const hasFramed = useRef(false);
  const [workflowVersion, setWorkflowVersion] = useState(0);

  const notifySimulatorTx = useCallback((cmd: string) => {
    for (const fn of simulatorListenersRef.current) {
      try {
        fn(cmd);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const onSimulatorSubscribe = useCallback((cb: (line: string) => void) => {
    simulatorListenersRef.current.add(cb);
    return () => {
      simulatorListenersRef.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    setMessages([]);
    setShowSimulator(false);
  }, []);

  useEffect(() => {
    currentLogRef.current = currentLog;
  }, [currentLog]);

  useEffect(() => {
    isTestFiringRef.current = isTestFiring;
  }, [isTestFiring]);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // Replay logging + job-complete detection (controller lives in App)
  useEffect(() => {
    const unsubProgress = controller.onProgress((prog) => {
      if (prog.percentComplete >= 100) {
        const r = activeReplayRef.current;
        if (r && r.status === 'running') {
          finalizeReplay(r, 'completed', prog.linesAcknowledged);
          saveReplay(r);
          setShowOutcome(true);
          activeReplayRef.current = null;
          setCurrentReplay({ ...r });
        }
      }
    });
    const unsubError = controller.onError((code, msg) => {
      setMessages(prev => [...prev.slice(-200), `ERROR ${code}: ${msg}`]);
      const r = activeReplayRef.current;
      if (r && r.status === 'running') {
        addReplayEntry(r, 'error', msg);
      }
      const jl = currentLogRef.current;
      if (jl && jl.status === 'running') {
        addLogEntry(jl, 'error', `${code}: ${msg}`);
      }
    });
    const unsubRaw = controller.onRawLine((line, dir) => {
      setMessages(prev => [...prev.slice(-200), `${dir === 'tx' ? '>' : '<'} ${line}`]);
      const r = activeReplayRef.current;
      if (r && r.status === 'running') {
        addReplayEntry(r, dir === 'tx' ? 'tx' : 'rx', line);
      }
      const jl = currentLogRef.current;
      if (jl && jl.status === 'running') {
        addLogEntry(jl, dir === 'tx' ? 'sent' : 'received', line);
      }
    });
    return () => {
      unsubProgress();
      unsubError();
      unsubRaw();
    };
  }, [controller]);

  // Job log: finalize when machine returns to idle after a running job
  useEffect(() => {
    if (!currentLog) return;
    if (currentLog.status !== 'running') return;

    const idle = machineState?.status === 'idle';
    const notRunning = !controllerRef.current?.isJobRunning;
    if (!idle || !notRunning) return;

    const linesCompleted = jobProgress?.linesAcknowledged ?? 0;
    const status = currentLog.errors > 0
      ? 'failed'
      : linesCompleted >= currentLog.gcodeLines
        ? 'completed'
        : 'stopped';

    finalizeLog(currentLog, status, linesCompleted);
    addLogEntry(
      currentLog,
      'milestone',
      status === 'completed'
        ? `Job completed in ${(currentLog.actualDuration / 1000).toFixed(0)}s`
        : status === 'failed'
          ? `Job failed with ${currentLog.errors} error(s)`
          : 'Job stopped by user',
    );
    saveJobLog(currentLog);
    setMessages(prev => [...prev, `✓ Job log saved (${status})`]);
    currentLogRef.current = null;
    setCurrentLog(null);
  }, [machineState?.status, currentLog, jobProgress?.linesAcknowledged, jobProgress?.totalLines]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const result = runPreflight(scene, gcode, machineState, bedWidth, bedHeight);
    setPreflight(result);
  }, [gcode, machineState, scene, bedWidth, bedHeight]);

  const isConnected = machineState?.status !== 'disconnected' && machineState?.status !== 'connecting' && machineState !== null;
  const isRunning = controllerRef.current?.isJobRunning || false;
  const displayPaused = isPaused || machineState?.status === 'hold';

  useEffect(() => {
    if (isConnected) {
      hasZeroed.current = false;
      hasFramed.current = false;
      setWorkflowVersion(v => v + 1);
    }
  }, [isConnected]);

  jobProgressRef.current = jobProgress;

  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      setIsPaused(false);

      const stopped = jobStoppedByUserRef.current;
      jobStoppedByUserRef.current = false;

      const jp = jobProgressRef.current;
      const t0 = jobStartTimeRef.current;
      const elapsedAtEnd = t0 != null ? Math.floor((Date.now() - t0) / 1000) : elapsedSecondsRef.current;

      const completedOk =
        !stopped &&
        jp != null &&
        jp.totalLines > 0 &&
        (jp.linesAcknowledged >= jp.totalLines ||
          (jp.percentComplete != null && jp.percentComplete >= 99.5));

      if (completedOk) {
        playCompletionBeep();
        setJobCompleted(true);
        setCompletedTime(Math.max(0, elapsedAtEnd));
        setProgressFlashGreen(true);
        window.setTimeout(() => setProgressFlashGreen(false), 1400);
      }

      jobStartTimeRef.current = null;
      setJobStartTime(null);
      elapsedSecondsRef.current = 0;
      setElapsedSeconds(0);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning || displayPaused) return;
    const tick = () => {
      const t0 = jobStartTimeRef.current;
      if (!t0) return;
      const e = Math.floor((Date.now() - t0) / 1000);
      elapsedSecondsRef.current = e;
      setElapsedSeconds(e);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isRunning, displayPaused, jobStartTime]);

  useEffect(() => {
    if (!jobCompleted) return;
    const t = window.setTimeout(() => setJobCompleted(false), 30000);
    return () => clearTimeout(t);
  }, [jobCompleted]);

  const sceneBounds = useMemo(
    () => ({
      minX: boundsMinX ?? 0,
      minY: boundsMinY ?? 0,
      maxX: boundsMaxX ?? 100,
      maxY: boundsMaxY ?? 100,
    }),
    [boundsMinX, boundsMinY, boundsMaxX, boundsMaxY],
  );

  const workFrame = useMemo(() => {
    const o = computeGcodeOffset(startMode, { minX: sceneBounds.minX, minY: sceneBounds.minY }, savedOrigin);
    return {
      minX: sceneBounds.minX + o.x,
      minY: sceneBounds.minY + o.y,
      maxX: sceneBounds.maxX + o.x,
      maxY: sceneBounds.maxY + o.y,
    };
  }, [startMode, savedOrigin, sceneBounds.minX, sceneBounds.minY, sceneBounds.maxX, sceneBounds.maxY]);

  const canFrame = isConnected && !isRunning;

  const fmtMm = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');

  const startPositionStatus =
    startMode === 'absolute'
      ? `Job starts at X${fmtMm(sceneBounds.minX)}, Y${fmtMm(sceneBounds.minY)} (canvas position)`
      : startMode === 'current' && machinePosition
        ? `Job starts at X${fmtMm(machinePosition.x)}, Y${fmtMm(machinePosition.y)} (head now)`
        : startMode === 'current'
          ? 'Connect to laser to use this mode'
          : savedOrigin
            ? `Job starts at X${fmtMm(savedOrigin.x)}, Y${fmtMm(savedOrigin.y)} (saved)`
            : 'No origin saved — save one below';

  // ─── Connection handlers ─────────────────────────────────

  const connectSimulator = async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    const mock = new MockSerialPort(undefined, { width: bedWidth, height: bedHeight });
    portRef.current = mock;
    mock.open();
    try {
      await ctrl.connect(mock);
      setIsSimulator(true);
      setMessages(prev => [...prev, '✓ Simulator connected']);
    } catch (e: any) {
      setMessages(prev => [...prev, `Connection failed: ${e.message}`]);
    }
  };

  const connectRealLaser = async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    if (!WebSerialPort.isSupported()) {
      setMessages(prev => [...prev, 'ERROR: Web Serial not supported in this browser']);
      return;
    }

    const ws = new WebSerialPort();
    portRef.current = ws;
    try {
      await ws.requestAndOpen(115200);
      setMessages(prev => [...prev, 'Port opened, waiting for GRBL welcome...']);
      await ctrl.connect(ws);
      setIsSimulator(false);
      setMessages(prev => [...prev, '✓ Real laser connected via USB']);
    } catch (e: any) {
      setMessages(prev => [...prev, `Connection failed: ${e.message}`]);
    }
  };

  const handleDisconnect = useCallback(async () => {
    const ctrl = controllerRef.current;
    jobStoppedByUserRef.current = true;
    try {
      if (ctrl?.isJobRunning) {
        try {
          ctrl.stop();
        } catch {
          /* ignore */
        }
      }

      if (testFireTimeoutRef.current) {
        clearTimeout(testFireTimeoutRef.current);
        testFireTimeoutRef.current = null;
      }
      if (isTestFiring) {
        notifySimulatorTx('M5 S0');
        try {
          ctrl?.sendCommand('M5 S0');
        } catch {
          /* ignore */
        }
      }
      setIsTestFiring(false);

      notifySimulatorTx('M5 S0');
      try {
        ctrl?.sendCommand('M5 S0');
      } catch {
        /* may already be disconnected */
      }

      try {
        await ctrl?.disconnect();
      } catch {
        /* ignore */
      }
    } catch {
      /* best effort — still reset local state and close panel */
    }

    portRef.current = null;
    setShowSimulator(false);
    setMessages([]);
    onDisconnect?.();
  }, [isTestFiring, notifySimulatorTx, onDisconnect]);

  // ─── Machine control ────────────────────────────────────

  const sendCmd = (cmd: string) => {
    notifySimulatorTx(cmd);
    try {
      controllerRef.current?.sendCommand(cmd);
    } catch (err: unknown) {
      console.warn('[Command blocked]', err instanceof Error ? err.message : err);
    }
  };

  const handleJog = useCallback(
    (axis: 'X' | 'Y', distance: number) => {
      const c = controllerRef.current;
      if (!c) return;
      const feedRate = 3000;
      const cmd = `$J=G91 G21 ${axis}${distance} F${feedRate}`;
      notifySimulatorTx(cmd);
      try {
        c.sendCommand(cmd);
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      setTimeout(() => {
        try {
          c.requestStatusReport();
        } catch {
          /* ignore */
        }
      }, 100);
    },
    [notifySimulatorTx],
  );

  const handleStartJob = async () => {
    if (!gcode || !controllerRef.current) return;
    setIsPaused(false);
    setJobCompleted(false);

    if (preflight && !preflight.canStart) {
      await showAlert(
        'Cannot start job',
        'Cannot start job — resolve all blockers first:\n\n' +
        preflight.issues
          .filter(i => i.severity === 'blocker')
          .map(i => `• ${i.title}${i.fix ? '\n  → ' + i.fix : ''}`)
          .join('\n\n'),
      );
      return;
    }

    if (preflight && preflight.warnings > 0) {
      const proceed = await showConfirm(
        'Start job?',
        `${preflight.warnings} warning(s):\n\n` +
        preflight.issues
          .filter(i => i.severity === 'warning')
          .map(i => `▲ ${i.title}`)
          .join('\n') +
        '\n\nStart job anyway?',
      );
      if (!proceed) return;
    }

    if (isTestFiring) {
      if (testFireTimeoutRef.current) {
        clearTimeout(testFireTimeoutRef.current);
        testFireTimeoutRef.current = null;
      }
      notifySimulatorTx('M5 S0');
      try {
        controllerRef.current?.sendCommand('M5 S0');
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      setIsTestFiring(false);
    }

    const lines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
    setMessages(prev => [...prev, `Starting job: ${lines.length} commands (readiness: ${preflight?.score ?? '?'}%)`]);
    try {
      const estimate = gcode ? estimateJobTime(gcode) : null;
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
      currentLogRef.current = jobLog;
      setCurrentLog(jobLog);

      // Start recording replay (before sendJob — TX lines emit synchronously inside sendJob)
      const layerSettings = scene.layers.filter(l => l.visible && l.output).map(l => ({
        name: l.name,
        mode: l.settings.mode,
        power: l.settings.power.max,
        speed: l.settings.speed,
        passes: l.settings.passes,
      }));
      const replay = createReplay(
        scene.metadata?.name || 'Untitled',
        lines.length,
        {
          layers: layerSettings,
          material: scene.material?.name || null,
          machineType: scene.machine?.type || null,
        },
        estimate ? estimate.totalSeconds * 1000 : null,
      );
      activeReplayRef.current = replay;
      setCurrentReplay(replay);

      for (const line of lines) notifySimulatorTx(line);
      controllerRef.current.sendJob(lines);
      jobStoppedByUserRef.current = false;
      const t0 = Date.now();
      jobStartTimeRef.current = t0;
      setJobStartTime(t0);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
    } catch (e: any) {
      activeReplayRef.current = null;
      currentLogRef.current = null;
      setCurrentLog(null);
      jobStartTimeRef.current = null;
      setJobStartTime(null);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
      setMessages(prev => [...prev, `Failed to start: ${e.message}`]);
    }
  };

  const confirmFrameBounds = useCallback(async (): Promise<boolean> => {
    const x1 = workFrame.minX;
    const y1 = workFrame.minY;
    const x2 = workFrame.maxX;
    const y2 = workFrame.maxY;

    const warnings: string[] = [];
    if (x1 < 0 || y1 < 0) warnings.push('Design has negative coordinates — laser may hit limit switches');
    if (x2 > bedWidth || y2 > bedHeight) warnings.push('Design extends beyond bed size');
    if ((x2 - x1) > bedWidth * 0.9 || (y2 - y1) > bedHeight * 0.9) {
      warnings.push('Frame covers most of the bed — make sure the laser has room');
    }

    if (warnings.length > 0) {
      const ok = await showConfirm(
        'Frame',
        'The design may extend beyond safe limits or the bed. Frame the boundary anyway?',
        warnings.join('\n'),
      );
      return ok;
    }
    return true;
  }, [workFrame, bedWidth, bedHeight, showConfirm]);

  const sendFrameLine = useCallback(
    async (ctrl: GrblController, line: string) => {
      notifySimulatorTx(line);
      try {
        ctrl.sendCommand(line);
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      await new Promise(r => setTimeout(r, 50));
    },
    [notifySimulatorTx],
  );

  const handleFrameSafe = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl || !canFrame) return;

    if (!(await confirmFrameBounds())) return;

    setMessages(prev => [...prev,
      `Framing (safe): X${workFrame.minX.toFixed(0)}-${workFrame.maxX.toFixed(0)} Y${workFrame.minY.toFixed(0)}-${workFrame.maxY.toFixed(0)}`,
    ]);

    const lines: string[] = [
      'G90',
      'G21',
      'M5 S0',
      `G0 X${workFrame.minX.toFixed(3)} Y${workFrame.minY.toFixed(3)}`,
      `G0 X${workFrame.maxX.toFixed(3)} Y${workFrame.minY.toFixed(3)}`,
      `G0 X${workFrame.maxX.toFixed(3)} Y${workFrame.maxY.toFixed(3)}`,
      `G0 X${workFrame.minX.toFixed(3)} Y${workFrame.maxY.toFixed(3)}`,
      `G0 X${workFrame.minX.toFixed(3)} Y${workFrame.minY.toFixed(3)}`,
      'M5 S0',
    ];

    for (const line of lines) {
      await sendFrameLine(ctrl, line);
    }

    hasFramed.current = true;
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Safe) complete']);
  }, [canFrame, confirmFrameBounds, workFrame, sendFrameLine]);

  const handleFrameDot = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl || !canFrame) return;

    if (!(await confirmFrameBounds())) return;

    const acknowledged = localStorage.getItem('laserforge_frame_dot_acknowledged');
    if (!acknowledged) {
      const ok = confirm(
        '⚠ Frame with Laser Dot enables the laser at low power during framing.\n\n' +
        'On slow diode lasers, even low power can scorch wood.\n\n' +
        'Use only with eye protection and material that can handle a brief mark.\n\n' +
        'Continue?',
      );
      if (!ok) return;
      localStorage.setItem('laserforge_frame_dot_acknowledged', 'true');
    }

    setMessages(prev => [...prev,
      `Framing (laser dot): X${workFrame.minX.toFixed(0)}-${workFrame.maxX.toFixed(0)} Y${workFrame.minY.toFixed(0)}-${workFrame.maxY.toFixed(0)}`,
    ]);

    const lines: string[] = [
      'G90', 'G21',
      // M4 = dynamic laser mode — fires during G1/G2/G3 only; correct while machine moves along frame
      'M4 S5',
      `G1 X${workFrame.minX.toFixed(3)} Y${workFrame.minY.toFixed(3)} F3000`,
      `G1 X${workFrame.maxX.toFixed(3)} Y${workFrame.minY.toFixed(3)} F3000`,
      `G1 X${workFrame.maxX.toFixed(3)} Y${workFrame.maxY.toFixed(3)} F3000`,
      `G1 X${workFrame.minX.toFixed(3)} Y${workFrame.maxY.toFixed(3)} F3000`,
      `G1 X${workFrame.minX.toFixed(3)} Y${workFrame.minY.toFixed(3)} F3000`,
      'M5 S0',
    ];

    for (const line of lines) {
      await sendFrameLine(ctrl, line);
    }

    hasFramed.current = true;
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Laser Dot) complete']);
  }, [canFrame, confirmFrameBounds, workFrame, sendFrameLine]);

  const handleZero = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    try {
      sendCmd('$X');
      await new Promise(r => setTimeout(r, 200));
      sendCmd('G10 L20 P1 X0 Y0');
      ctrl.requestStatusReport();
      hasZeroed.current = true;
      setWorkflowVersion(v => v + 1);
      setMessages(prev => [...prev, '✓ Work origin set at current position — matches “Where Head Is” G-code mode']);
    } catch {
      setMessages(prev => [...prev, 'Zero failed — try again']);
    }
  }, []);

  const handleHome = useCallback(async () => {
    const ok = await showConfirm('Homing', 'Homing moves to limit switches. Continue?');
    if (ok) sendCmd('$H');
  }, [showConfirm]);

  const handleUnlock = useCallback(() => {
    sendCmd('$X');
  }, []);

  const handlePauseResume = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    const held = isPaused || machineState?.status === 'hold';
    try {
      if (held) {
        ctrl.resume();
        setIsPaused(false);
      } else {
        ctrl.pause();
        setIsPaused(true);
      }
    } catch (err: unknown) {
      console.warn('[Pause/Resume]', err instanceof Error ? err.message : err);
    }
  }, [isPaused, machineState?.status]);

  const handleStop = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    jobStoppedByUserRef.current = true;
    try {
      ctrl.stop();
      await new Promise(r => setTimeout(r, 500));
      notifySimulatorTx('M5 S0');
      try {
        ctrl.sendCommand('M5 S0');
      } catch {
        /* ignore */
      }
      await new Promise(r => setTimeout(r, 200));
      notifySimulatorTx('$X');
      try {
        ctrl.sendCommand('$X');
      } catch {
        /* ignore */
      }
      setIsPaused(false);
    } catch (err: unknown) {
      console.warn('[Stop]', err instanceof Error ? err.message : err);
    }
  }, [notifySimulatorTx]);

  const handleTestFire = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    if (isTestFiring) {
      if (testFireTimeoutRef.current) {
        clearTimeout(testFireTimeoutRef.current);
        testFireTimeoutRef.current = null;
      }
      notifySimulatorTx('M5 S0');
      try {
        ctrl.sendCommand('M5 S0');
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      setIsTestFiring(false);
      return;
    }

    if (machineState?.status === 'alarm') return;

    const acknowledged = localStorage.getItem('laserforge_testfire_acknowledged');
    if (!acknowledged) {
      const ok = confirm(
        '⚠ Test Fire enables the laser at low power.\n\n' +
        'Make sure:\n' +
        '• Eye protection is on\n' +
        '• Nothing flammable directly under the laser\n\n' +
        'Click the button again to turn off.\n\n' +
        'Continue?',
      );
      if (!ok) return;
      localStorage.setItem('laserforge_testfire_acknowledged', 'true');
    }

    // M3 = constant spindle mode — fires laser even when stationary (GRBL $32 laser mode)
    // S20 = low power. If $30=1000, ~2%; if $30=255, ~8%.
    if (testFireTimeoutRef.current) {
      clearTimeout(testFireTimeoutRef.current);
      testFireTimeoutRef.current = null;
    }
    try {
      notifySimulatorTx('M3 S20');
      ctrl.sendCommand('M3 S20');
    } catch (err: unknown) {
      console.warn('[Command blocked]', err instanceof Error ? err.message : err);
    }
    setIsTestFiring(true);
    testFireTimeoutRef.current = setTimeout(() => {
      testFireTimeoutRef.current = null;
      notifySimulatorTx('M5 S0');
      try {
        controllerRef.current?.sendCommand('M5 S0');
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
      setIsTestFiring(false);
    }, 10000);
  }, [notifySimulatorTx, isTestFiring, machineState?.status]);

  useEffect(() => {
    return () => {
      if (testFireTimeoutRef.current) {
        clearTimeout(testFireTimeoutRef.current);
        testFireTimeoutRef.current = null;
      }
      if (isTestFiringRef.current) {
        notifySimulatorTx('M5 S0');
        try {
          controllerRef.current?.sendCommand('M5 S0');
        } catch (err: unknown) {
          console.warn('[Command blocked]', err instanceof Error ? err.message : err);
        }
      }
    };
  }, [notifySimulatorTx]);

  const btnStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    background: disabled ? '#1a1a2e' : `rgba(${color}, 0.1)`,
    border: `1px solid ${disabled ? '#252540' : `rgba(${color}, 0.4)`}`,
    borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
    fontFamily: font, opacity: disabled ? 0.5 : 1,
    color: disabled ? '#333355' : `rgb(${color})`,
  });

  const readinessScore = preflight?.score ?? null;
  const issues = (preflight?.issues ?? []).filter(
    i => i.severity !== 'info' || i.id === 'layer-output-summaries',
  );

  const estimatedRemaining = useMemo(() => {
    if (!jobProgress || jobStartTime == null || jobProgress.linesAcknowledged < 2 || !jobProgress.totalLines) {
      return null;
    }
    const elapsed = (Date.now() - jobStartTime) / 1000;
    if (elapsed < 0.01) return null;
    const rate = jobProgress.linesAcknowledged / elapsed;
    if (!Number.isFinite(rate) || rate < 1e-6) return null;
    const remaining = (jobProgress.totalLines - jobProgress.linesAcknowledged) / rate;
    return Math.max(0, Math.round(remaining));
  }, [jobProgress, jobStartTime, elapsedSeconds]);

  const jogBtnStyle: React.CSSProperties = {
    padding: '10px', fontSize: 16, borderRadius: 6, cursor: 'pointer',
    background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
    fontFamily: font, lineHeight: 1,
  };

  const jogCellStyle: React.CSSProperties = {
    ...jogBtnStyle,
    width: 38,
    height: 38,
    padding: 0,
    fontSize: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const jogCell = (label: string, axis: 'X' | 'Y', distance: number, tooltip: string) =>
    React.createElement('button', {
      type: 'button',
      onClick: () => handleJog(axis, distance),
      title: tooltip,
      style: jogCellStyle,
    }, label);

  const posX = machinePosition?.x ?? machineState?.position.x;
  const posY = machinePosition?.y ?? machineState?.position.y;
  const canStartJob = !!gcode && !isRunning && !!preflight?.canStart && !gcodeStale;
  void workflowVersion;

  const statusSection = React.createElement('div', {
    style: {
      padding: '10px 16px', borderBottom: '1px solid #1a1a2e',
      background: isConnected ? 'rgba(45,212,160,0.04)' : '#0a0a14',
      flexShrink: 0,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    },
  },
    React.createElement('div', null,
      React.createElement('div', {
        style: { fontSize: 13, fontWeight: 600, color: isConnected ? '#2dd4a0' : '#8888aa' },
      }, isConnected ? `⚡ Connected${isSimulator ? ' (Sim)' : ''}` : '⚡ Not Connected'),
      isConnected && React.createElement('div', {
        style: { fontSize: 10, fontFamily: mono, color: '#555570', marginTop: 2 },
      },
        `${machineState?.status || 'Unknown'}  ·  X:${posX != null && Number.isFinite(posX) ? posX.toFixed(1) : '?'}  Y:${posY != null && Number.isFinite(posY) ? posY.toFixed(1) : '?'}`,
      ),
    ),
    React.createElement('button', {
      type: 'button',
      onClick: onClose,
      style: { background: 'none', border: 'none', color: '#555570', fontSize: 16, cursor: 'pointer', padding: '0 4px' },
    }, '×'),
  );

  const connectSection = React.createElement('div', {
    style: {
      padding: '30px 20px', display: 'flex', flexDirection: 'column' as const, gap: 10, alignItems: 'center', flex: 1,
      justifyContent: 'center', minHeight: 0,
    },
  },
    React.createElement('div', { style: { fontSize: 36, marginBottom: 8 } }, '⚡'),
    React.createElement('div', { style: { fontSize: 14, color: '#8888aa', marginBottom: 16 } }, 'Connect your laser to get started'),
    WebSerialPort.isSupported() && React.createElement('button', {
      type: 'button',
      onClick: () => { void connectRealLaser(); },
      style: {
        width: '100%', maxWidth: 280, padding: '14px', fontSize: 13, fontWeight: 600,
        borderRadius: 10, cursor: 'pointer', fontFamily: font,
        background: 'rgba(0,212,255,0.08)', border: '1px solid #00d4ff', color: '#00d4ff',
      },
    }, '🔌 Connect via USB'),
    React.createElement('button', {
      type: 'button',
      onClick: () => { void connectSimulator(); },
      style: {
        width: '100%', maxWidth: 280, padding: '12px', fontSize: 12,
        borderRadius: 10, cursor: 'pointer', fontFamily: font,
        background: '#0a0a14', border: '1px solid #252540', color: '#555570',
      },
    }, '🖥 Use Simulator'),
  );

  const step1Done = hasZeroed.current;
  const step3Done = hasFramed.current;
  const startJobDesc = canStartJob
    ? 'Ready to cut!'
    : gcodeStale
      ? 'Recompile G-code (design changed)'
      : !preflight?.canStart
        ? 'Fix issues below first'
        : 'Prepare job';

  const workflowSection = isConnected && React.createElement('div', {
    style: { padding: '12px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 1 } }, 'Workflow'),
    ...([
      {
        num: 1,
        label: 'Jog to workpiece',
        description: 'Move the laser head to where you want to start',
        done: step1Done,
        action: undefined as (() => void) | undefined,
        actionLabel: '',
        primary: false,
        disabled: false,
      },
      {
        num: 2,
        label: 'Zero position',
        description: 'Set this as the starting point',
        done: step1Done,
        action: () => { void handleZero(); },
        actionLabel: '◎ Zero Here',
        primary: false,
        disabled: false,
      },
      {
        num: 3,
        label: 'Frame the job',
        description: 'Preview where the laser will cut — use Frame below',
        done: step3Done,
        action: undefined as (() => void) | undefined,
        actionLabel: '',
        primary: false,
        disabled: false,
      },
      {
        num: 4,
        label: 'Start job',
        description: startJobDesc,
        done: false,
        action: undefined as (() => void) | undefined,
        actionLabel: '',
        primary: true,
        disabled: false,
      },
    ] as const).map(step =>
      React.createElement('div', {
        key: step.num,
        style: {
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 0',
          borderBottom: step.num < 4 ? '1px solid #12121e' : 'none',
          opacity: step.num === 4 && !canStartJob ? 0.55 : 1,
        },
      },
        React.createElement('div', {
          style: {
            width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, fontFamily: mono,
            background: step.done ? 'rgba(45,212,160,0.15)' : '#0a0a14',
            border: step.done ? '1px solid #2dd4a0' : '1px solid #252540',
            color: step.done ? '#2dd4a0' : '#555570',
          },
        }, step.done ? '✓' : String(step.num)),
        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
          React.createElement('div', { style: { fontSize: 12, color: step.done ? '#2dd4a0' : '#e0e0ec', fontWeight: 500 } }, step.label),
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 1 } }, step.description),
        ),
        step.action && React.createElement('button', {
          type: 'button',
          onClick: step.action,
          disabled: step.disabled,
          style: {
            padding: step.primary ? '8px 20px' : '6px 12px',
            fontSize: step.primary ? 12 : 10,
            fontWeight: 600, borderRadius: 6, cursor: step.disabled ? 'default' : 'pointer',
            fontFamily: font, flexShrink: 0, whiteSpace: 'nowrap' as const,
            background: step.primary
              ? (canStartJob ? 'rgba(45,212,160,0.12)' : '#1a1a2e')
              : '#0a0a14',
            border: step.primary
              ? (canStartJob ? '1px solid #2dd4a0' : '1px solid #252540')
              : '1px solid #252540',
            color: step.primary
              ? (canStartJob ? '#2dd4a0' : '#333355')
              : '#c0c0d0',
            opacity: step.disabled && step.num === 3 ? (canFrame ? 1 : 0.45) : 1,
          },
        }, step.actionLabel),
      ),
    ),
  );

  const controlsSection = isConnected && React.createElement('div', {
    style: { padding: '12px 16px', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 16, flexShrink: 0 },
  },
    React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4 },
    },
      React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'Jog'),
      React.createElement('div', {
        style: { display: 'grid', gridTemplateColumns: '38px 38px 38px', gap: 3 },
      },
        React.createElement('div', { key: 'j0' }),
        jogCell('↑', 'Y', jogStep, 'Jog Y+'),
        React.createElement('div', { key: 'j1' }),
        jogCell('←', 'X', -jogStep, 'Jog X-'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { void handleHome(); },
          title: 'Home machine ($H)',
          style: { ...jogCellStyle, background: 'rgba(255,212,68,0.06)', fontSize: 14 },
        }, '⌂'),
        jogCell('→', 'X', jogStep, 'Jog X+'),
        React.createElement('div', { key: 'j2' }),
        jogCell('↓', 'Y', -jogStep, 'Jog Y-'),
        React.createElement('div', { key: 'j3' }),
      ),
      React.createElement('div', {
        style: { display: 'flex', gap: 2, marginTop: 4 },
      },
        ...[0.1, 1, 10, 50].map(j =>
          React.createElement('button', {
            type: 'button',
            key: j,
            onClick: () => setJogStep(j),
            style: {
              padding: '2px 7px', fontSize: 9, borderRadius: 3, cursor: 'pointer',
              fontFamily: mono,
              background: jogStep === j ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: jogStep === j ? '1px solid #00d4ff' : '1px solid #1a1a2e',
              color: jogStep === j ? '#00d4ff' : '#555570',
            },
          }, `${j}`),
        ),
      ),
    ),
    React.createElement('div', {
      style: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 6, minWidth: 0 },
    },
      React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 1 } }, 'Start Position'),
      React.createElement('div', { style: { display: 'flex', gap: 3, marginBottom: 6 } },
        ...([
          { mode: 'absolute' as const, label: '📍 Bed' },
          { mode: 'current' as const, label: '🎯 Head' },
          { mode: 'savedOrigin' as const, label: '⚑ Origin' },
        ]).map(m =>
          React.createElement('button', {
            type: 'button',
            key: m.mode,
            onClick: () => onSelectMode(m.mode),
            disabled: m.mode === 'current' && !machinePosition,
            style: {
              flex: 1, padding: '4px', fontSize: 9, borderRadius: 4, cursor: 'pointer', fontFamily: font,
              background: startMode === m.mode ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: startMode === m.mode ? '1px solid #00d4ff' : '1px solid #252540',
              color: startMode === m.mode ? '#00d4ff' : '#555570',
              opacity: m.mode === 'current' && !machinePosition ? 0.4 : 1,
            },
          }, m.label),
        ),
      ),
      React.createElement('div', { style: { fontSize: 9, color: '#555570', lineHeight: 1.25, marginBottom: 4 } }, startPositionStatus),
      (startMode === 'savedOrigin' || isConnected) && React.createElement('button', {
        type: 'button',
        onClick: onSaveOrigin,
        disabled: !isConnected,
        title: isConnected ? 'Store current head X/Y as the saved reference' : 'Connect to laser to save origin from head position',
        style: {
          marginBottom: 4,
          padding: 0,
          background: 'none',
          border: 'none',
          color: '#00d4ff',
          fontSize: 9,
          cursor: isConnected ? 'pointer' : 'default',
          fontFamily: font,
          textDecoration: 'underline',
          textAlign: 'left' as const,
          opacity: isConnected ? 1 : 0.45,
        },
      }, '📌 Save current head position as origin'),
      machineState?.status === 'alarm' && React.createElement('button', {
        type: 'button',
        onClick: handleUnlock,
        title: 'Clear alarm state ($X)',
        style: {
          width: '100%', padding: '6px', fontSize: 10, fontWeight: 600, borderRadius: 6,
          cursor: 'pointer', fontFamily: font,
          background: 'rgba(255,212,68,0.08)', border: '1px solid rgba(255,212,68,0.3)',
          color: '#ffd444',
        },
      }, '🔓 Unlock'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleTestFire(); },
        disabled: machineState?.status === 'alarm' || isRunning,
        title: isTestFiring ? 'Click to turn laser off' : 'Low-power laser pulse',
        style: {
          width: '100%', padding: '7px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          cursor: machineState?.status === 'alarm' || isRunning ? 'default' : 'pointer', fontFamily: font,
          background: isTestFiring ? 'rgba(255,68,102,0.15)' : 'rgba(255,68,102,0.05)',
          border: isTestFiring ? '1px solid #ff4466' : '1px solid rgba(255,68,102,0.2)',
          color: isTestFiring ? '#ff4466' : '#ff6680',
          opacity: machineState?.status === 'alarm' || isRunning ? 0.4 : 1,
          animation: isTestFiring ? 'laserforgePulse 1s infinite' : 'none',
        },
      }, isTestFiring ? '🔴 Laser OFF' : '🔥 Test Fire'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleFrameDot(); },
        disabled: !canFrame,
        title: 'Trace outline with low-power laser dot',
        style: {
          width: '100%', padding: '5px', fontSize: 9, borderRadius: 4,
          cursor: canFrame ? 'pointer' : 'default', fontFamily: font,
          background: 'transparent', border: '1px solid #1a1a2e', color: '#555570',
          opacity: canFrame ? 1 : 0.4,
        },
      }, '◉ Frame with Laser Dot'),
      gcode && React.createElement('div', {
        style: {
          padding: '6px 8px', background: '#08080f', borderRadius: 6, border: '1px solid #1a1a2e',
          display: 'flex', justifyContent: 'space-between', fontSize: 9, marginTop: 4,
        },
      },
        React.createElement('span', { style: { color: '#555570' } }, 'Est. time'),
        React.createElement('span', { style: { color: '#00d4ff', fontFamily: mono, fontWeight: 600 } }, estimateJobTime(gcode).formatted),
      ),
    ),
  );

  const layerOverviewRows: React.ReactNode[] = [];
  for (const layer of scene.layers) {
    if (!layer.visible || layer.output === false) continue;
    const objectCount = scene.objects.filter(o => o.layerId === layer.id && o.visible).length;
    if (objectCount === 0) continue;
    const m = layer.settings.mode;
    const modeColor =
      m === 'cut' ? '#ff4466' : m === 'engrave' ? '#00d4ff' : m === 'score' ? '#2dd4a0' : '#f0b429';

    layerOverviewRows.push(
      React.createElement('div', {
        key: layer.id,
        style: {
          padding: '8px 10px', marginBottom: 4,
          background: '#08080f', borderRadius: 6,
          border: `1px solid ${modeColor}22`,
        },
      },
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
        },
          React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            React.createElement('div', {
              style: { width: 8, height: 8, borderRadius: '50%', background: modeColor, flexShrink: 0 },
            }),
            React.createElement('span', { style: { fontSize: 11, color: '#e0e0ec', fontWeight: 600 } },
              layer.name || `Layer ${layer.id.slice(0, 4)}`,
            ),
          ),
          React.createElement('span', { style: { fontSize: 9, color: '#555570' } },
            `${objectCount} object${objectCount !== 1 ? 's' : ''}`,
          ),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 3, marginBottom: 6 } },
          ...([
            { mode: 'cut' as const, label: 'Cut', color: '#ff4466' },
            { mode: 'engrave' as const, label: 'Engrave', color: '#00d4ff' },
            { mode: 'score' as const, label: 'Score', color: '#2dd4a0' },
            { mode: 'image' as const, label: 'Image', color: '#f0b429' },
          ]).map(mm =>
            React.createElement('button', {
              type: 'button',
              key: mm.mode,
              onClick: () => { onUpdateLayerMode?.(layer.id, mm.mode); },
              style: {
                flex: 1, padding: '3px', fontSize: 9, borderRadius: 3,
                cursor: onUpdateLayerMode ? 'pointer' : 'default', fontFamily: font,
                background: m === mm.mode ? `${mm.color}18` : 'transparent',
                border: m === mm.mode ? `1px solid ${mm.color}` : '1px solid #1a1a2e',
                color: m === mm.mode ? mm.color : '#555570',
              },
            }, mm.label),
          ),
        ),
        m === 'engrave' && onUpdateLayerFillMode && React.createElement('div', {
          style: { display: 'flex', gap: 3, marginBottom: 6 },
        },
          ...([
            { mode: 'line' as const, label: 'Line fill' },
            { mode: 'offset' as const, label: 'Offset' },
            { mode: 'cross-hatch' as const, label: 'Cross-hatch' },
          ]).map(f =>
            React.createElement('button', {
              type: 'button',
              key: f.mode,
              onClick: () => { onUpdateLayerFillMode(layer.id, f.mode); },
              style: {
                flex: 1, padding: '3px', fontSize: 9, borderRadius: 3,
                cursor: 'pointer', fontFamily: font,
                background: layer.settings.fill.mode === f.mode ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: layer.settings.fill.mode === f.mode ? '1px solid #00d4ff' : '1px solid #1a1a2e',
                color: layer.settings.fill.mode === f.mode ? '#00d4ff' : '#555570',
              },
            }, f.label),
          ),
        ),
        m === 'engrave' && onUpdateLayerFillInterval && React.createElement('div', {
          style: { marginTop: 6, marginBottom: 4 },
        },
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
          },
            React.createElement('span', { style: { fontSize: 9, color: '#555570' } }, 'Line spacing'),
            React.createElement('span', { style: { fontSize: 9, color: '#00d4ff', fontFamily: mono } },
              `${(Number(layer.settings.fill.interval) > 0 ? layer.settings.fill.interval : 0.1).toFixed(2)}mm`,
            ),
          ),
          React.createElement('input', {
            type: 'range',
            min: 0.02,
            max: 1,
            step: 0.02,
            value: Math.min(1, Math.max(0.02, Number(layer.settings.fill.interval) > 0 ? layer.settings.fill.interval : 0.1)),
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              onUpdateLayerFillInterval(layer.id, parseFloat(e.target.value));
            },
            style: { width: '100%', accentColor: '#00d4ff', height: 4 },
          }),
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#333355', marginTop: 1 },
          },
            React.createElement('span', null, 'Dense (0.02)'),
            React.createElement('span', null, 'Light (1.0)'),
          ),
        ),
        m === 'engrave' && onUpdateLayerFillBidirectional && React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 },
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: layer.settings.fill.biDirectional !== false,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              onUpdateLayerFillBidirectional(layer.id, e.target.checked);
            },
            style: { accentColor: '#00d4ff', width: 12, height: 12, flexShrink: 0 },
          }),
          React.createElement('span', { style: { fontSize: 10, color: '#8888aa' } }, 'Bidirectional scanning'),
          React.createElement('span', { style: { fontSize: 8, color: '#555570' } }, '(faster)'),
        ),
        React.createElement('div', {
          style: { display: 'flex', gap: 8, fontSize: 9, fontFamily: mono, color: '#555570' },
        },
          React.createElement('span', null, `${layer.settings.power.max}%`),
          React.createElement('span', null, `${layer.settings.speed}mm/min`),
          React.createElement('span', null, `${layer.settings.passes}x`),
        ),
      ),
    );
  }

  const layerOverviewSection =
    isConnected &&
    !isRunning &&
    !displayPaused &&
    onUpdateLayerMode &&
    layerOverviewRows.length > 0 &&
    React.createElement('div', {
      style: { padding: '10px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
    },
      React.createElement('div', {
        style: { fontSize: 10, color: '#555570', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 1 },
      }, 'Layers'),
      ...layerOverviewRows,
    );

  const gcodeWarning = isConnected && gcodeStale && !isRunning && React.createElement('div', {
    style: {
      margin: '0 16px', padding: '10px 14px',
      background: 'rgba(255,212,68,0.06)', border: '1px solid rgba(255,212,68,0.2)',
      borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexShrink: 0,
    },
  },
    React.createElement('div', null,
      React.createElement('div', { style: { fontSize: 11, color: '#ffd444', fontWeight: 600 } }, '⚠ Design changed'),
      React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 2 } }, 'G-code is outdated — recompile before cutting'),
    ),
    React.createElement('button', {
      type: 'button',
      onClick: () => { onRecompile?.(); },
      style: {
        padding: '6px 14px', fontSize: 11, fontWeight: 600, borderRadius: 6,
        cursor: 'pointer', fontFamily: font,
        background: 'rgba(255,212,68,0.1)', border: '1px solid #ffd444', color: '#ffd444',
      },
    }, '↻ Update'),
  );

  const issuesSection = isConnected && !isRunning && !displayPaused && (issues.length > 0 || readinessScore != null) && React.createElement('div', {
    style: { padding: '10px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 } }, 'Issues'),
    ...issues.map((issue: PreflightIssue, i: number) =>
      React.createElement('div', {
        key: issue.id ?? i,
        style: {
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '6px 0',
          borderBottom: i < issues.length - 1 ? '1px solid #12121e' : 'none',
        },
      },
        React.createElement('span', {
          style: {
            fontSize: 12, flexShrink: 0, marginTop: 1,
            color: issue.severity === 'blocker'
              ? '#ff4466'
              : issue.severity === 'info'
                ? '#8888aa'
                : '#ffd444',
          },
        }, issue.severity === 'blocker' ? '✗' : issue.severity === 'info' ? 'ℹ' : '⚠'),
        React.createElement('div', null,
          React.createElement('div', {
            style: {
              fontSize: 11,
              color: issue.severity === 'blocker' ? '#ff4466' : issue.severity === 'info' ? '#c0c0d8' : '#ffd444',
            },
          }, issue.title),
          issue.detail && React.createElement('div', {
            style: { fontSize: 9, color: '#555570', marginTop: 2, whiteSpace: 'pre-line' as const, fontFamily: mono },
          }, issue.detail),
          issue.fix && React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 2 } }, issue.fix),
        ),
      ),
    ),
    readinessScore != null && React.createElement('div', {
      style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 },
    },
      React.createElement('span', {
        style: {
          fontSize: 10, fontWeight: 600, fontFamily: mono,
          padding: '2px 8px', borderRadius: 4,
          background: readinessScore >= 80 ? 'rgba(45,212,160,0.1)' : readinessScore >= 50 ? 'rgba(255,212,68,0.1)' : 'rgba(255,68,102,0.1)',
          color: readinessScore >= 80 ? '#2dd4a0' : readinessScore >= 50 ? '#ffd444' : '#ff4466',
        },
      }, `Readiness: ${readinessScore}%`),
    ),
  );

  const outcomeExtrasSection = isConnected && !isRunning && !displayPaused && React.createElement(React.Fragment, null,
    jobCompleted && React.createElement('div', {
      style: {
        padding: '12px', margin: '0 16px 8px',
        background: 'rgba(45,212,160,0.08)', border: '1px solid rgba(45,212,160,0.3)',
        borderRadius: 8, textAlign: 'center' as const,
      },
    },
      React.createElement('div', { style: { fontSize: 20, marginBottom: 4 } }, '✓'),
      React.createElement('div', { style: { fontSize: 13, color: '#2dd4a0', fontWeight: 600 } }, 'Job Complete'),
      React.createElement('div', { style: { fontSize: 10, color: '#555570', marginTop: 4, fontFamily: mono } },
        `Finished in ${formatJobTime(completedTime)}`,
      ),
    ),
    showOutcome && currentReplay && React.createElement('div', {
      style: {
        margin: '0 16px 8px',
        padding: '10px', background: 'rgba(45,212,160,0.06)',
        borderRadius: 8, border: '1px solid rgba(45,212,160,0.2)',
      },
    },
      React.createElement('div', {
        style: { fontSize: 11, fontWeight: 600, color: '#2dd4a0', marginBottom: 8 },
      }, '✓ Job complete — how did it turn out?'),
      React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap' as const } },
        ...(['perfect', 'too_dark', 'too_light', 'didnt_cut', 'burned'] as const).map(outcome =>
          React.createElement('button', {
            key: outcome,
            type: 'button',
            onClick: () => {
              if (currentReplay) {
                currentReplay.outcome = outcome;
                saveReplay(currentReplay);
                if (currentReplay.settings.material) {
                  for (const layer of currentReplay.settings.layers) {
                    recordMaterialOutcome({
                      material: currentReplay.settings.material,
                      machineType: currentReplay.settings.machineType || 'diode',
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
              setShowOutcome(false);
              setMessages(prev => [...prev, `Outcome recorded: ${outcome.replace(/_/g, ' ')}`]);
            },
            style: {
              padding: '5px 8px', fontSize: 10, cursor: 'pointer',
              background: 'rgba(255,255,255,0.03)', border: '1px solid #252540',
              borderRadius: 6, color: '#8888aa', fontFamily: font,
            },
          }, outcome === 'perfect' ? '✓ Perfect' :
             outcome === 'too_dark' ? 'Too dark' :
             outcome === 'too_light' ? 'Too light' :
             outcome === 'didnt_cut' ? "Didn't cut" :
             'Burned'),
        ),
        React.createElement('button', {
          type: 'button',
          onClick: () => setShowOutcome(false),
          style: {
            padding: '5px 8px', fontSize: 10, cursor: 'pointer',
            background: 'transparent', border: '1px solid #1a1a2e',
            borderRadius: 6, color: '#555570', fontFamily: font,
          },
        }, 'Skip'),
      ),
    ),
  );

  const jobProgressSection = isConnected && (isRunning || displayPaused) && React.createElement('div', {
    style: { padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: 12, flexShrink: 0 },
  },
    React.createElement('div', { style: { textAlign: 'center' as const } },
      React.createElement('div', {
        style: { fontSize: 16, fontWeight: 700, color: displayPaused ? '#ffd444' : '#2dd4a0' },
      }, displayPaused ? '⏸ Paused' : '▶ Cutting...'),
    ),
    React.createElement('div', null,
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8888aa', marginBottom: 4 },
      },
        React.createElement('span', { style: { fontFamily: mono } },
          `${jobProgress?.percentComplete?.toFixed(0) ?? 0}%`,
        ),
        React.createElement('span', { style: { fontFamily: mono } },
          `${jobProgress?.linesAcknowledged ?? 0} / ${jobProgress?.totalLines ?? 0}`,
        ),
      ),
      React.createElement('div', {
        style: { width: '100%', height: 10, background: '#1a1a2e', borderRadius: 5, overflow: 'hidden' },
      },
        React.createElement('div', {
          style: {
            width: `${(isRunning || displayPaused) ? (jobProgress?.percentComplete ?? 0) : 0}%`,
            height: '100%',
            background: displayPaused ? '#ffd444' : '#2dd4a0',
            borderRadius: 5,
            transition: 'width 0.3s',
          },
        }),
      ),
    ),
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: mono, color: '#555570' },
    },
      React.createElement('span', null, `Elapsed: ${formatJobTime(elapsedSeconds)}`),
      estimatedRemaining != null && estimatedRemaining > 0 &&
        React.createElement('span', null, `~${formatJobTime(estimatedRemaining)} left`),
    ),
  );

  const footerSection = isConnected && React.createElement('div', {
    style: {
      padding: '10px 16px',
      borderTop: '1px solid #1a1a2e',
      background: '#0d0d18',
      flexShrink: 0,
    },
  },
    !isRunning && !displayPaused && React.createElement('div', {
      style: { display: 'flex', gap: 6 },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleFrameSafe(); },
        disabled: !canFrame,
        style: {
          flex: 1, padding: '12px', fontSize: 12, fontWeight: 600,
          borderRadius: 8, cursor: canFrame ? 'pointer' : 'default',
          fontFamily: font,
          background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
          opacity: canFrame ? 1 : 0.4,
        },
      }, '⬚ Frame'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleStartJob(); },
        disabled: !canStartJob,
        style: {
          flex: 2, padding: '12px', fontSize: 14, fontWeight: 700,
          borderRadius: 8, cursor: canStartJob ? 'pointer' : 'default',
          fontFamily: font,
          background: canStartJob ? 'rgba(45,212,160,0.12)' : '#1a1a2e',
          border: canStartJob ? '1px solid #2dd4a0' : '1px solid #252540',
          color: canStartJob ? '#2dd4a0' : '#333355',
        },
      }, `▶ START${isSimulator ? ' (Sim)' : ''}`),
    ),
    (isRunning || displayPaused) && React.createElement('div', {
      style: { display: 'flex', gap: 6 },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handlePauseResume(); },
        style: {
          flex: 1, padding: '14px', fontSize: 13, fontWeight: 700,
          borderRadius: 8, cursor: 'pointer', fontFamily: font,
          background: displayPaused ? 'rgba(45,212,160,0.1)' : 'rgba(255,212,68,0.08)',
          border: displayPaused ? '2px solid #2dd4a0' : '2px solid rgba(255,212,68,0.4)',
          color: displayPaused ? '#2dd4a0' : '#ffd444',
        },
      }, displayPaused ? '▶ Resume' : '⏸ Pause'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleStop(); },
        style: {
          flex: 1, padding: '14px', fontSize: 13, fontWeight: 700,
          borderRadius: 8, cursor: 'pointer', fontFamily: font,
          background: 'rgba(255,68,102,0.08)',
          border: '2px solid rgba(255,68,102,0.4)',
          color: '#ff4466',
        },
      }, '⏹ Stop'),
    ),
  );

  const moreSection = isConnected && React.createElement('div', {
    style: { borderTop: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => setShowMore(v => !v),
      style: {
        width: '100%', padding: '8px 16px', fontSize: 10,
        background: 'transparent', border: 'none', color: '#555570',
        cursor: 'pointer', fontFamily: font,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      },
    },
      React.createElement('span', null, 'More options'),
      React.createElement('span', null, showMore ? '▲' : '▼'),
    ),
    showMore && React.createElement('div', {
      style: { padding: '8px 16px 12px', display: 'flex', flexDirection: 'column' as const, gap: 6, maxHeight: 200, overflowY: 'auto' as const },
    },
      React.createElement(DeviceProfileSelector, {
        scene,
        onSceneCommit,
        onMessage: (msg: string) => setMessages(prev => [...prev, msg]),
        showConfirm,
        showPrompt,
      }),
      isSimulator && React.createElement('button', {
        type: 'button',
        onClick: () => setShowSimulator(v => !v),
        style: {
          width: '100%', padding: '8px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontFamily: font,
          background: showSimulator ? 'rgba(0,212,255,0.06)' : '#0a0a14',
          border: showSimulator ? '1px solid rgba(0,212,255,0.2)' : '1px solid #252540',
          color: showSimulator ? '#00d4ff' : '#555570',
        },
      }, showSimulator ? 'Hide Simulator' : 'Show Simulator'),
      React.createElement(JobLogViewer, {
        onLoadLog: (entries: string[]) => setMessages(entries),
        showConfirm,
      }),
      productionMode && React.createElement('div', {
        ref: logRef,
        style: {
          minHeight: 60, maxHeight: 100, padding: '6px 8px', background: '#08080f', borderRadius: 6,
          border: '1px solid #1a1a2e', overflow: 'auto', fontFamily: mono, fontSize: 9, lineHeight: 1.45,
        },
      },
        messages.length === 0
          ? React.createElement('span', { style: { color: '#333355' } }, 'Console…')
          : messages.map((msg, i) =>
              React.createElement('div', { key: i, style: { color: msg.startsWith('ERROR') || msg.startsWith('⚠') ? '#ff4466' : msg.startsWith('>') ? '#00d4ff' : msg.startsWith('✓') ? '#2dd4a0' : '#555570' } }, msg),
            ),
      ),
      !productionMode && messages.length > 0 && React.createElement('div', {
        style: { fontSize: 10, color: '#555570', lineHeight: 1.4 },
      }, React.createElement('span', {
        style: { color: messages[messages.length - 1].startsWith('✓') ? '#2dd4a0' : messages[messages.length - 1].startsWith('ERROR') ? '#ff4466' : '#8888aa' } },
      messages[messages.length - 1])),
      productionMode && jobProgress && React.createElement('div', {
        style: { fontSize: 10, color: '#555570', fontFamily: mono },
      }, `Buffer ${jobProgress.bufferFill ?? 0}/127`),
      productionMode && React.createElement('div', { style: { display: 'flex', gap: 6 } },
        React.createElement('input', {
          type: 'text', value: manualCmd, placeholder: 'G-code…',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setManualCmd(e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') { sendCmd(manualCmd); setManualCmd(''); } },
          style: { flex: 1, padding: '6px 8px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#e0e0ec', fontSize: 10, fontFamily: mono, outline: 'none' },
        }),
        React.createElement('button', { type: 'button', onClick: () => { sendCmd(manualCmd); setManualCmd(''); }, style: btnStyle('0,212,255') }, 'Send'),
      ),
      React.createElement('div', {
        style: { fontSize: 9, color: '#444460', paddingTop: 4 },
      }, 'GRBL 1.1+ · Character-counting buffer · 5Hz status polling'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleDisconnect(); },
        style: {
          width: '100%', padding: '8px', fontSize: 11, marginTop: 4,
          borderRadius: 6, cursor: 'pointer', fontFamily: font,
          background: 'transparent', border: '1px solid #252540', color: '#555570',
        },
      }, 'Disconnect'),
    ),
  );

  const simulatorView = showSimulator && isSimulator && isConnected && React.createElement('div', {
    style: { height: 250, borderTop: '1px solid #1a1a2e', flexShrink: 0, minHeight: 160 },
  },
    React.createElement(SimulatorView, {
      onSubscribe: onSimulatorSubscribe,
      bedWidth,
      bedHeight,
      liveHead:
        machineState && machineState.status !== 'disconnected' && machineState.status !== 'connecting'
          ? { x: machineState.position.x, y: machineState.position.y }
          : null,
      jobRunning: isRunning,
    }),
  );

  // ─── Render ─────────────────────────────────────────────
  // Sidebar layout: parent row provides width; this fills height beside the canvas.

  return React.createElement(React.Fragment, null,
    React.createElement('style', {}, '@keyframes laserforgePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }'),
    React.createElement('div', {
      style: {
        width: 450,
        flexShrink: 0,
        height: '100%',
        minHeight: 0,
        background: '#0d0d18',
        borderLeft: '1px solid #1a1a2e',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
        fontFamily: font,
      },
    },
      statusSection,
      !isConnected && connectSection,
      isConnected && React.createElement('div', {
        style: {
          flex: 1,
          minHeight: 0,
          overflowY: 'auto' as const,
          overflowX: 'hidden' as const,
          display: 'flex',
          flexDirection: 'column' as const,
        },
      },
        !isRunning && !displayPaused && workflowSection,
        !isRunning && !displayPaused && controlsSection,
        layerOverviewSection,
        (isRunning || displayPaused) && jobProgressSection,
        gcodeWarning,
        issuesSection,
        outcomeExtrasSection,
        moreSection,
        simulatorView,
      ),
      footerSection,
      isConnected && React.createElement('div', {
        style: {
          padding: '8px 14px 12px', borderTop: '1px solid #1a1a2e',
          flexShrink: 0,
        },
      },
        React.createElement('button', {
          type: 'button',
          onClick: () => {
            jobStoppedByUserRef.current = true;
            if (testFireTimeoutRef.current) {
              clearTimeout(testFireTimeoutRef.current);
              testFireTimeoutRef.current = null;
            }
            setIsTestFiring(false);
            controllerRef.current?.stop();
            try {
              notifySimulatorTx('M5 S0');
              controllerRef.current?.sendCommand('M5 S0');
            } catch (err: unknown) {
              console.warn('[Command blocked]', err instanceof Error ? err.message : err);
            }
            setIsPaused(false);
            setMessages(prev => [...prev, '⚠ EMERGENCY STOP']);
          },
          style: {
            width: '100%', padding: '10px',
            background: 'rgba(255,68,102,0.15)',
            border: '2px solid #ff4466',
            borderRadius: 6, color: '#ff4466',
            fontSize: 12, fontWeight: 700, cursor: 'pointer',
            fontFamily: font,
          },
        }, '⚠ EMERGENCY STOP'),
      ),
    ),
  );
}
