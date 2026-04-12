import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type GrblController } from '../../controllers/grbl/GrblController';
import { MockSerialPort } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';
import { type Scene } from '../../core/scene/Scene';
import { DeviceProfileSelector } from './DeviceProfileSelector';
import { JobLogViewer } from './JobLogViewer';
import { runPreflight, type PreflightResult } from '../../core/preflight/PreflightChecker';
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
  onOpenStartWizard: () => void;
  onSaveOrigin: () => void;
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
  onOpenStartWizard: _onOpenStartWizard,
  onSaveOrigin,
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

  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const logRef = useRef<HTMLDivElement>(null);
  /** Same object as currentReplay while a job is recording; set before sendJob so sync TX callbacks see it */
  const activeReplayRef = useRef<JobReplay | null>(null);
  const currentLogRef = useRef<JobLog | null>(null);
  const simulatorListenersRef = useRef(new Set<(line: string) => void>());

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

  const prevRunningRef = useRef(isRunning);
  useEffect(() => {
    if (prevRunningRef.current && !isRunning) {
      setIsPaused(false);
    }
    prevRunningRef.current = isRunning;
  }, [isRunning]);

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

  const modeBtn = (active: boolean, dimmed: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '6px 4px',
    borderRadius: 6,
    fontSize: 10,
    fontFamily: font,
    fontWeight: 600,
    cursor: dimmed ? 'default' : 'pointer',
    ...(dimmed
      ? {
          background: '#15151e',
          border: '1px solid #252540',
          color: '#555570',
          opacity: 0.45,
        }
      : active
        ? {
            background: 'rgba(0,212,255,0.1)',
            border: '1px solid #00d4ff',
            color: '#00d4ff',
          }
        : {
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid #252540',
            color: '#8888aa',
          }),
  });

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
    } catch (e: any) {
      activeReplayRef.current = null;
      currentLogRef.current = null;
      setCurrentLog(null);
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

  const posX = machinePosition?.x ?? machineState?.position.x;
  const posY = machinePosition?.y ?? machineState?.position.y;
  const canStart = !!gcode && !isRunning;
  const readinessScore = preflight?.score ?? null;
  const issues = (preflight?.issues ?? []).filter(i => i.severity !== 'info');

  const jogBtnStyle: React.CSSProperties = {
    padding: '10px', fontSize: 16, borderRadius: 6, cursor: 'pointer',
    background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
    fontFamily: font, lineHeight: 1,
  };

  const jogBtn = (label: string, axis: 'X' | 'Y', distance: number, tooltip: string) =>
    React.createElement('button', {
      type: 'button',
      onClick: () => handleJog(axis, distance),
      title: tooltip,
      style: jogBtnStyle,
    }, label);

  const statusBar = React.createElement('div', {
    style: {
      padding: '10px 14px', borderBottom: '1px solid #1a1a2e',
      background: isConnected ? 'rgba(45,212,160,0.04)' : '#0a0a14',
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    },
      React.createElement('span', {
        style: { fontSize: 12, fontWeight: 600, color: isConnected ? '#2dd4a0' : '#8888aa' },
      }, isConnected ? `⚡ Connected${isSimulator ? ' (Simulator)' : ''}` : '⚡ Not Connected'),
      React.createElement('button', {
        type: 'button',
        onClick: onClose,
        style: { background: 'none', border: 'none', color: '#555570', fontSize: 14, cursor: 'pointer', padding: 0 },
      }, '×'),
    ),
    isConnected && React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: mono },
    },
      React.createElement('span', {
        style: { color: machineState?.status === 'alarm' ? '#ff4466' : '#555570' },
      }, `Status: ${machineState?.status || 'Unknown'}`),
      React.createElement('span', { style: { color: '#555570' } },
        `X:${posX != null && Number.isFinite(posX) ? posX.toFixed(1) : '?'}  Y:${posY != null && Number.isFinite(posY) ? posY.toFixed(1) : '?'}`,
      ),
    ),
  );

  const connectOptions = React.createElement('div', {
    style: { padding: '20px 14px', display: 'flex', flexDirection: 'column' as const, gap: 8, alignItems: 'center', flex: 1, minHeight: 0 },
  },
    React.createElement('div', { style: { fontSize: 28, marginBottom: 4 } }, '⚡'),
    React.createElement('div', { style: { fontSize: 13, color: '#8888aa', marginBottom: 12 } }, 'Connect your laser'),
    WebSerialPort.isSupported() && React.createElement('button', {
      type: 'button',
      onClick: () => { void connectRealLaser(); },
      style: {
        width: '100%', padding: '12px', fontSize: 12, fontWeight: 600,
        borderRadius: 8, cursor: 'pointer', fontFamily: font,
        background: 'rgba(0,212,255,0.08)', border: '1px solid #00d4ff', color: '#00d4ff',
      },
    }, '🔌 Connect via USB'),
    React.createElement('button', {
      type: 'button',
      onClick: () => { void connectSimulator(); },
      style: {
        width: '100%', padding: '10px', fontSize: 11,
        borderRadius: 8, cursor: 'pointer', fontFamily: font,
        background: '#0a0a14', border: '1px solid #252540', color: '#555570',
      },
    }, '🖥 Use Simulator'),
  );

  const movementControls = isConnected && React.createElement('div', {
    style: { padding: '12px 14px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, maxWidth: 160, margin: '0 auto 10px' },
    },
      React.createElement('div', { key: 'e0' }),
      jogBtn('↑', 'Y', -jogStep, 'Jog Y+'),
      React.createElement('div', { key: 'e1' }),
      jogBtn('←', 'X', -jogStep, 'Jog X-'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleHome(); },
        title: 'Home machine ($H)',
        style: { ...jogBtnStyle, background: 'rgba(255,212,68,0.06)', fontSize: 12 },
      }, '⌂'),
      jogBtn('→', 'X', jogStep, 'Jog X+'),
      React.createElement('div', { key: 'e2' }),
      jogBtn('↓', 'Y', jogStep, 'Jog Y-'),
      React.createElement('div', { key: 'e3' }),
    ),
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'center', gap: 3, marginBottom: 10, flexWrap: 'wrap' as const },
    },
      ...[0.1, 1, 10, 50].map(step =>
        React.createElement('button', {
          type: 'button',
          key: step,
          onClick: () => setJogStep(step),
          style: {
            padding: '3px 10px', fontSize: 10, borderRadius: 4, cursor: 'pointer',
            fontFamily: mono,
            background: jogStep === step ? 'rgba(0,212,255,0.1)' : '#0a0a14',
            border: jogStep === step ? '1px solid #00d4ff' : '1px solid #252540',
            color: jogStep === step ? '#00d4ff' : '#555570',
          },
        }, `${step}mm`),
      ),
    ),
    React.createElement('div', {
      style: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleZero(); },
        title: 'Set current position as work origin (0,0)',
        style: {
          flex: 1, padding: '8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          cursor: 'pointer', fontFamily: font,
          background: 'rgba(45,212,160,0.08)', border: '1px solid rgba(45,212,160,0.3)',
          color: '#2dd4a0', minWidth: 72,
        },
      }, '◎ Zero'),
      machineState?.status === 'alarm' && React.createElement('button', {
        type: 'button',
        onClick: handleUnlock,
        title: 'Clear alarm state ($X)',
        style: {
          flex: 1, padding: '8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          cursor: 'pointer', fontFamily: font,
          background: 'rgba(255,212,68,0.08)', border: '1px solid rgba(255,212,68,0.3)',
          color: '#ffd444', minWidth: 72,
        },
      }, '🔓 Unlock'),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleTestFire(); },
        disabled: machineState?.status === 'alarm' || isRunning,
        title: isTestFiring ? 'Click to turn laser off' : 'Low-power laser pulse',
        style: {
          flex: 1, padding: '8px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          cursor: machineState?.status === 'alarm' || isRunning ? 'default' : 'pointer',
          fontFamily: font,
          background: isTestFiring ? 'rgba(255,68,102,0.15)' : 'rgba(255,68,102,0.05)',
          border: isTestFiring ? '1px solid #ff4466' : '1px solid rgba(255,68,102,0.2)',
          color: isTestFiring ? '#ff4466' : '#ff6680',
          opacity: machineState?.status === 'alarm' || isRunning ? 0.4 : 1,
          animation: isTestFiring ? 'laserforgePulse 1s infinite' : 'none',
          minWidth: 72,
        },
      }, isTestFiring ? '🔴 OFF' : '🔥 Fire'),
    ),
  );

  const jobControls = isConnected && React.createElement('div', {
    style: { padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 8, overflowY: 'auto' as const, minHeight: 0 },
  },
    React.createElement('div', { style: { marginBottom: 2 } },
      React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 4, fontWeight: 600 } }, 'Start Position'),
      React.createElement('div', { style: { display: 'flex', gap: 4, width: '100%' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => onSelectMode('absolute'),
          title: 'Design cuts exactly where placed on canvas',
          style: modeBtn(startMode === 'absolute', false),
        }, '📍 Bed'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { if (machinePosition) onSelectMode('current'); },
          disabled: !machinePosition,
          title: 'Job starts at current laser position',
          style: modeBtn(startMode === 'current', !machinePosition),
        }, '🎯 Head'),
        React.createElement('button', {
          type: 'button',
          onClick: () => onSelectMode('savedOrigin'),
          title: 'Job starts at your saved reference point',
          style: modeBtn(startMode === 'savedOrigin', false),
        }, '⚑ Origin'),
      ),
      React.createElement('div', { style: { fontSize: 10, color: '#555570', marginTop: 4, lineHeight: 1.35 } }, startPositionStatus),
      (startMode === 'savedOrigin' || isConnected) && React.createElement('button', {
        type: 'button',
        onClick: onSaveOrigin,
        disabled: !isConnected,
        title: isConnected ? 'Store current head X/Y as the saved reference' : 'Connect to laser to save origin from head position',
        style: {
          marginTop: 6,
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
    ),

    gcode && React.createElement('div', {
      style: {
        padding: '6px 10px', background: '#08080f', borderRadius: 6, border: '1px solid #1a1a2e',
        display: 'flex', justifyContent: 'space-between', fontSize: 10,
      },
    },
      React.createElement('span', { style: { color: '#555570' } }, 'Est. time'),
      React.createElement('span', { style: { color: '#00d4ff', fontFamily: mono, fontWeight: 600 } }, estimateJobTime(gcode).formatted),
    ),

    !isRunning && !displayPaused && React.createElement(React.Fragment, null,
      React.createElement('div', {
        style: { display: 'flex', gap: 6, marginTop: 4 },
      },
        React.createElement('button', {
          type: 'button',
          onClick: () => { void handleFrameSafe(); },
          disabled: !canFrame,
          title: 'Trace outline with laser OFF',
          style: {
            flex: 1, padding: '10px 8px', fontSize: 11, fontWeight: 600,
            borderRadius: 8, cursor: canFrame ? 'pointer' : 'default',
            fontFamily: font,
            background: '#0a0a14', border: '1px solid #252540', color: '#c0c0d0',
            opacity: canFrame ? 1 : 0.4,
          },
        }, '⬚ Frame'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { void handleStartJob(); },
          disabled: !canStart,
          title: 'Start laser job',
          style: {
            flex: 2, padding: '10px 8px', fontSize: 13, fontWeight: 700,
            borderRadius: 8, cursor: canStart ? 'pointer' : 'default',
            fontFamily: font,
            background: canStart ? 'rgba(45,212,160,0.12)' : '#1a1a2e',
            border: canStart ? '1px solid #2dd4a0' : '1px solid #252540',
            color: canStart ? '#2dd4a0' : '#333355',
          },
        }, `▶ START${isSimulator ? ' (Sim)' : ''}`),
      ),
      React.createElement('button', {
        type: 'button',
        onClick: () => { void handleFrameDot(); },
        disabled: !canFrame,
        title: 'Trace outline with low-power laser dot',
        style: {
          width: '100%', padding: '6px', fontSize: 10,
          borderRadius: 6, cursor: canFrame ? 'pointer' : 'default',
          fontFamily: font,
          background: 'transparent', border: '1px solid #1a1a2e', color: '#555570',
          opacity: canFrame ? 1 : 0.4,
        },
      }, '◉ Frame with Laser Dot'),
    ),

    isRunning && React.createElement(React.Fragment, null,
      React.createElement('div', {
        style: { marginTop: 4 },
      },
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#8888aa', marginBottom: 4 },
        },
          React.createElement('span', null, displayPaused ? '⏸ Paused' : '▶ Running...'),
          React.createElement('span', { style: { fontFamily: mono } },
            `${jobProgress?.percentComplete?.toFixed(0) ?? 0}%`,
          ),
        ),
        React.createElement('div', {
          style: { width: '100%', height: 8, background: '#1a1a2e', borderRadius: 4, overflow: 'hidden' },
        },
          React.createElement('div', {
            style: {
              width: `${jobProgress?.percentComplete ?? 0}%`,
              height: '100%',
              background: displayPaused ? '#ffd444' : '#2dd4a0',
              borderRadius: 4,
              transition: 'width 0.3s',
            },
          }),
        ),
        React.createElement('div', {
          style: { fontSize: 9, color: '#555570', marginTop: 4, fontFamily: mono },
        }, `${jobProgress?.linesAcknowledged ?? 0} / ${jobProgress?.totalLines ?? 0} lines`),
      ),
      React.createElement('div', {
        style: { display: 'flex', gap: 6, marginTop: 8 },
      },
        React.createElement('button', {
          type: 'button',
          onClick: () => { void handlePauseResume(); },
          style: {
            flex: 1, padding: '12px', fontSize: 12, fontWeight: 600,
            borderRadius: 8, cursor: 'pointer', fontFamily: font,
            background: displayPaused ? 'rgba(45,212,160,0.1)' : 'rgba(255,212,68,0.08)',
            border: displayPaused ? '1px solid #2dd4a0' : '1px solid rgba(255,212,68,0.3)',
            color: displayPaused ? '#2dd4a0' : '#ffd444',
          },
        }, displayPaused ? '▶ Resume' : '⏸ Pause'),
        React.createElement('button', {
          type: 'button',
          onClick: () => { void handleStop(); },
          style: {
            flex: 1, padding: '12px', fontSize: 12, fontWeight: 600,
            borderRadius: 8, cursor: 'pointer', fontFamily: font,
            background: 'rgba(255,68,102,0.08)',
            border: '1px solid rgba(255,68,102,0.3)',
            color: '#ff4466',
          },
        }, '⏹ Stop'),
      ),
    ),

    !isRunning && !displayPaused && readinessScore != null && React.createElement('div', {
      style: { marginTop: 8, padding: '8px 10px', background: '#08080f', borderRadius: 6, border: '1px solid #1a1a2e' },
    },
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('span', { style: { fontSize: 10, color: '#555570' } }, 'Readiness'),
        React.createElement('span', {
          style: {
            fontSize: 11, fontWeight: 600, fontFamily: mono,
            color: readinessScore >= 80 ? '#2dd4a0' : readinessScore >= 50 ? '#ffd444' : '#ff4466',
          },
        }, `${readinessScore}%`),
      ),
      issues.length > 0 && React.createElement('div', {
        style: { marginTop: 6 },
      },
        ...issues.slice(0, 3).map((issue, i) =>
          React.createElement('div', {
            key: issue.id ?? i,
            style: { fontSize: 9, color: issue.severity === 'blocker' ? '#ff4466' : '#ffd444', marginTop: 2 },
          }, `${issue.severity === 'blocker' ? '✗' : '⚠'} ${issue.title}`),
        ),
        issues.length > 3 && React.createElement('div', {
          style: { fontSize: 9, color: '#333355', marginTop: 2 },
        }, `+${issues.length - 3} more`),
      ),
    ),

    showOutcome && currentReplay && React.createElement('div', {
      style: {
        marginTop: 8,
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

  const moreSection = isConnected && React.createElement('div', {
    style: { borderTop: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('button', {
      type: 'button',
      onClick: () => setShowMore(v => !v),
      style: {
        width: '100%', padding: '8px 14px', fontSize: 10,
        background: 'transparent', border: 'none', color: '#555570',
        cursor: 'pointer', fontFamily: font,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      },
    },
      React.createElement('span', null, 'More options'),
      React.createElement('span', null, showMore ? '▲' : '▼'),
    ),
    showMore && React.createElement('div', {
      style: { padding: '8px 14px 12px', display: 'flex', flexDirection: 'column' as const, gap: 6, maxHeight: 220, overflowY: 'auto' as const },
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
          width: '100%', padding: '8px', fontSize: 10, borderRadius: 6, cursor: 'pointer', fontFamily: font,
          background: 'rgba(255,212,68,0.06)', border: '1px solid rgba(255,212,68,0.25)', color: '#ffd444',
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

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('style', {}, '@keyframes laserforgePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }'),
    React.createElement('div', {
      style: {
        width: 280,
        height: '90vh',
        maxHeight: 720,
        background: '#0d0d18',
        border: '1px solid #252540',
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
        fontFamily: font,
      },
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
    },
      statusBar,
      !isConnected && connectOptions,
      isConnected && React.createElement('div', {
        style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
      },
        movementControls,
        jobControls,
      ),
      moreSection,
      simulatorView,
      isConnected && React.createElement('div', {
        style: {
          padding: '8px 14px 12px', borderTop: '1px solid #1a1a2e',
          flexShrink: 0,
        },
      },
        React.createElement('button', {
          type: 'button',
          onClick: () => {
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
