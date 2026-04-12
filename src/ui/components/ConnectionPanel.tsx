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

  const handleProofRun = async () => {
    if (!gcode || !controllerRef.current) return;

    const status = machineState?.status;
    if (status === 'alarm') {
      await showAlert('Machine', 'Machine is in ALARM state. Click Unlock ($X) first.');
      return;
    }
    if (status === 'hold') {
      await showAlert('Machine', 'Machine is paused. Click Resume or Stop first.');
      return;
    }
    if (status === 'run') {
      await showAlert('Machine', 'A job is already running. Wait for it to finish or Stop it.');
      return;
    }
    if (status === 'homing') {
      await showAlert('Machine', 'Machine is homing. Wait for it to finish.');
      return;
    }
    if (status !== 'idle' && status !== undefined) {
      await showAlert('Machine', `Machine not ready (state: ${status}). Wait for idle.`);
      return;
    }

    if (preflight && preflight.issues.some(i => i.severity === 'blocker' && i.category === 'machine')) {
      const machineBlockers = preflight.issues.filter(i => i.severity === 'blocker' && i.category === 'machine');
      await showAlert(
        'Proof Mode',
        'Cannot run proof — resolve machine blockers first:\n\n' +
        machineBlockers.map(i => `• ${i.title}`).join('\n')
      );
      return;
    }

    const lines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));

    // Build a fast proof: laser off, rapid speed, skip dense raster lines
    const proofLines: string[] = [];
    let lastX = '', lastY = '';
    let skippedCount = 0;

    for (const line of lines) {
      // Always keep setup/teardown commands
      if (line.startsWith('G21') || line.startsWith('G90') || line.startsWith('M2') || line.startsWith('M5')) {
        proofLines.push(line);
        continue;
      }

      // Kill all laser power
      if (line.startsWith('M4 ') || line.startsWith('M3 ')) {
        proofLines.push('M5 S0');
        continue;
      }
      if (line.startsWith('M8') || line.startsWith('M9')) {
        continue; // Skip air assist in proof
      }

      // Rapid moves — keep as-is, they're already fast
      if (line.startsWith('G0 ')) {
        proofLines.push(line);
        const xm = line.match(/X([-\d.]+)/);
        const ym = line.match(/Y([-\d.]+)/);
        if (xm) lastX = xm[1];
        if (ym) lastY = ym[1];
        continue;
      }

      // G1 cutting moves — keep only moves that change position significantly
      if (line.startsWith('G1 ')) {
        const xm = line.match(/X([-\d.]+)/);
        const ym = line.match(/Y([-\d.]+)/);
        const newX = xm ? xm[1] : lastX;
        const newY = ym ? ym[1] : lastY;

        // Skip if position barely changed (dense raster lines)
        const dx = Math.abs(parseFloat(newX) - parseFloat(lastX || '0'));
        const dy = Math.abs(parseFloat(newY) - parseFloat(lastY || '0'));

        if (dx < 0.5 && dy < 0.5) {
          skippedCount++;
          continue; // Skip micro-moves (raster scanlines)
        }

        // Convert to rapid move at high speed, no power
        proofLines.push(`G0 X${newX} Y${newY}`);
        lastX = newX;
        lastY = newY;
        continue;
      }

      // Keep everything else (G4 dwells, etc) but strip power
      proofLines.push(line.replace(/S\d+/g, 'S0'));
    }

    setMessages(prev => [...prev,
      `PROOF RUN: ${proofLines.length} moves (${skippedCount} raster lines skipped)`,
      `Original: ${lines.length} commands → Proof: ${proofLines.length} commands`,
    ]);

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

    try {
      for (const line of proofLines) notifySimulatorTx(line);
      controllerRef.current.sendJob(proofLines);
    } catch (e: any) {
      setMessages(prev => [...prev, `Proof run failed: ${e.message}`]);
    }
  };

  // ─── Styles ─────────────────────────────────────────────

  const btnStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
    padding: '6px 14px',
    background: disabled ? '#1a1a2e' : `rgba(${color}, 0.1)`,
    border: `1px solid ${disabled ? '#252540' : `rgba(${color}, 0.4)`}`,
    borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
    fontFamily: font, opacity: disabled ? 0.5 : 1,
    color: disabled ? '#333355' : `rgb(${color})`,
  });

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
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 520, maxHeight: '90vh',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
        display: 'flex', flexDirection: 'column' as const,
        overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: { padding: '14px 18px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
      },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          React.createElement('div', {
            style: {
              width: 8, height: 8, borderRadius: '50%',
              background: isConnected ? '#2dd4a0' : '#ff4466',
              boxShadow: isConnected ? '0 0 8px rgba(45,212,160,0.4)' : 'none',
            },
          }),
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 14, fontWeight: 600 } }, 'Laser Connection'),
          isSimulator && isConnected && React.createElement('span', {
            style: { fontSize: 9, color: '#ffd444', background: 'rgba(255,212,68,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,212,68,0.2)' },
          }, 'SIMULATOR'),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 18, cursor: 'pointer' },
        }, '×'),
      ),

      // Scrollable content (everything below header except sticky Emergency Stop)
      React.createElement('div', {
        style: {
          flex: 1,
          minHeight: 0,
          overflowY: 'auto' as const,
          overflowX: 'hidden' as const,
        },
      },

      // Connect section
      !isConnected && React.createElement('div', { style: { padding: '16px 18px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            onClick: connectSimulator,
            style: { ...btnStyle('255, 212, 68'), flex: 1, padding: '12px' },
          }, 'Simulator'),
          WebSerialPort.isSupported() && React.createElement('button', {
            onClick: connectRealLaser,
            style: { ...btnStyle('45, 212, 160'), flex: 1, padding: '12px', fontWeight: 600 },
          }, 'Select USB Port'),
        ),
        React.createElement('div', { style: { fontSize: 10, color: '#555570', marginTop: 8, textAlign: 'center' as const } },
          'Simulator for testing. USB for real laser (GRBL 1.1+).'
        ),
      ),

      // Start position — visible before connect (Head dimmed without machine position)
      React.createElement('div', { style: { padding: '12px 18px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('div', { style: { marginBottom: 6 } },
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
      ),

      // Disconnect
      isConnected && React.createElement('div', { style: { padding: '8px 18px', display: 'flex', justifyContent: 'flex-end' } },
        React.createElement('button', { onClick: () => void handleDisconnect(), style: btnStyle('255, 68, 102') }, 'Disconnect'),
      ),

      isSimulator && isConnected && React.createElement('div', { style: { padding: '4px 18px 8px', borderBottom: '1px solid #1a1a2e' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setShowSimulator(v => !v),
          style: { ...btnStyle('255, 212, 68'), width: '100%', fontSize: 10, padding: '6px' },
        }, showSimulator ? 'Hide Simulator' : 'Show Simulator'),
      ),

      isConnected && React.createElement(DeviceProfileSelector, {
        scene,
        onSceneCommit,
        onMessage: (msg: string) => setMessages(prev => [...prev, msg]),
        showConfirm,
        showPrompt,
      }),

      // Step-by-step workflow guide — highlights current step based on state
      isConnected && React.createElement('div', {
        style: {
          padding: '10px 18px', background: 'rgba(0,212,255,0.04)',
          borderBottom: '1px solid #1a1a2e', fontSize: 11, lineHeight: 1.6,
        },
      },
        React.createElement('strong', { style: { color: '#00d4ff', fontSize: 10, display: 'block', marginBottom: 6 } }, 'WORKFLOW'),

        // Step 1: Unlock
        React.createElement('div', {
          style: {
            padding: '4px 8px', marginBottom: 3, borderRadius: 4,
            background: machineState?.status === 'alarm' ? 'rgba(255,212,68,0.08)' : 'transparent',
            color: machineState?.status === 'alarm' ? '#ffd444' : '#555570',
          },
        }, machineState?.status === 'alarm' ? '→ 1. Click Unlock — machine is in alarm' : '✓ 1. Unlock (if needed)'),

        // Step 2: Jog
        React.createElement('div', {
          style: {
            padding: '4px 8px', marginBottom: 3, borderRadius: 4,
            background: machineState?.status === 'idle' && (machineState?.position.x !== 0 || machineState?.position.y !== 0) ? 'transparent' :
                        machineState?.status === 'idle' ? 'rgba(0,212,255,0.08)' : 'transparent',
            color: machineState?.status === 'idle' ? '#8888aa' : '#555570',
          },
        }, '2. Use jog arrows to move laser to your workpiece corner'),

        // Step 3: Zero
        React.createElement('div', {
          style: {
            padding: '4px 8px', marginBottom: 3, borderRadius: 4,
            color: '#8888aa',
          },
        }, '3. Press ZERO — this is where the laser starts and returns'),

        // Step 4: Frame
        React.createElement('div', {
          style: {
            padding: '4px 8px', marginBottom: 3, borderRadius: 4,
            color: '#8888aa',
          },
        }, '4. Press Frame — laser traces the outline at low power to check alignment'),

        // Step 5: Start
        React.createElement('div', {
          style: {
            padding: '4px 8px', marginBottom: 3, borderRadius: 4,
            color: gcode ? '#8888aa' : '#555570',
          },
        }, '5. Press Start Job — the cut begins'),

        // Important warnings
        React.createElement('div', {
          style: { marginTop: 6, padding: '6px 8px', background: 'rgba(255,170,50,0.06)', borderRadius: 4, border: '1px solid rgba(255,170,50,0.15)' },
        },
          React.createElement('div', { style: { color: '#ffaa32', fontSize: 10, fontWeight: 600, marginBottom: 3 } }, 'IMPORTANT'),
          React.createElement('div', { style: { color: '#8888aa', fontSize: 10, lineHeight: 1.5 } },
            '• Use jog arrows to move the laser, not by hand', React.createElement('br'),
            '• If you moved it by hand, press ZERO to sync', React.createElement('br'),
            '• Frame shows where the laser will cut — check before starting', React.createElement('br'),
            '• Emergency Stop is always at the bottom of this panel',
          ),
        ),
      ),

      // Machine Readiness Score
      isConnected && preflight && React.createElement('div', {
        style: { padding: '12px 18px', borderBottom: '1px solid #1a1a2e' },
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: preflight.issues.filter(i => i.severity !== 'info').length > 0 ? 10 : 0 },
        },
          React.createElement('div', {
            style: {
              width: 48, height: 48, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17, fontWeight: 700, fontFamily: mono,
              background: preflight.score >= 80 ? 'rgba(45,212,160,0.1)' :
                          preflight.score >= 50 ? 'rgba(255,212,68,0.1)' :
                          'rgba(255,68,102,0.1)',
              border: `2px solid ${preflight.score >= 80 ? '#2dd4a0' : preflight.score >= 50 ? '#ffd444' : '#ff4466'}`,
              color: preflight.score >= 80 ? '#2dd4a0' : preflight.score >= 50 ? '#ffd444' : '#ff4466',
              flexShrink: 0,
            },
          }, `${preflight.score}`),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', {
              style: {
                fontSize: 13, fontWeight: 600,
                color: preflight.canStart ? '#2dd4a0' : '#ff4466',
              },
            }, preflight.canStart ? 'Ready to cut' : 'Not ready'),
            React.createElement('div', {
              style: { fontSize: 10, color: '#555570', marginTop: 2 },
            },
              preflight.blockers > 0 ? `${preflight.blockers} blocker${preflight.blockers !== 1 ? 's' : ''}` : '',
              preflight.blockers > 0 && preflight.warnings > 0 ? ', ' : '',
              preflight.warnings > 0 ? `${preflight.warnings} warning${preflight.warnings !== 1 ? 's' : ''}` : '',
              preflight.blockers === 0 && preflight.warnings === 0 ? 'All checks passed' : '',
            ),
          ),
        ),

        ...preflight.issues.filter(i => i.severity !== 'info').map(issue =>
          React.createElement('div', {
            key: issue.id,
            style: {
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '5px 0', fontSize: 11, lineHeight: 1.4,
            },
          },
            React.createElement('span', {
              style: {
                fontSize: 10, marginTop: 2, flexShrink: 0,
                color: issue.severity === 'blocker' ? '#ff4466' : '#ffd444',
              },
            }, issue.severity === 'blocker' ? '●' : '▲'),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { color: '#e0e0ec', fontWeight: 500 } }, issue.title),
              issue.fix && React.createElement('div', { style: { color: '#555570', fontSize: 10, marginTop: 1 } }, issue.fix),
            ),
          ),
        ),
      ),

      // Proof mode — dry run (pairs with readiness score)
      isConnected && gcode && React.createElement('div', {
        style: {
          padding: '8px 18px', borderBottom: '1px solid #1a1a2e',
          background: 'rgba(136, 180, 255, 0.04)',
        },
      },
        React.createElement('div', {
          style: { fontSize: 10, color: '#88b4ff', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 4 },
        }, 'Proof mode'),
        React.createElement('div', { style: { fontSize: 11, color: '#8888aa', lineHeight: 1.45 } },
          'Runs the same path with the laser off and rasters thinned — verify motion on the machine before cutting.',
        ),
      ),

      // Position + state
      isConnected && React.createElement('div', { style: { padding: '8px 18px', display: 'flex', gap: 16 } },
        React.createElement('div', { style: { flex: 1, background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'POSITION'),
          React.createElement('div', { style: { fontFamily: mono, fontSize: 16, color: '#e0e0ec' } },
            `X${machineState?.position.x.toFixed(2) || '0.00'}  Y${machineState?.position.y.toFixed(2) || '0.00'}`
          ),
        ),
        React.createElement('div', { style: { background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'STATE'),
          React.createElement('div', { style: {
            fontFamily: mono, fontSize: 14, fontWeight: 600,
            color: machineState?.status === 'idle' ? '#2dd4a0' : machineState?.status === 'run' ? '#00d4ff' : machineState?.status === 'alarm' ? '#ff4466' : '#ffd444',
          } }, (machineState?.status || 'IDLE').toUpperCase()),
        ),
        productionMode && React.createElement('div', { style: { background: '#0a0a14', borderRadius: 6, padding: '8px 12px', border: '1px solid #1a1a2e' } },
          React.createElement('div', { style: { fontSize: 9, color: '#555570', marginBottom: 2 } }, 'BUFFER'),
          React.createElement('div', { style: { fontFamily: mono, fontSize: 14, color: '#8888aa' } },
            `${jobProgress?.bufferFill || 0}/127`
          ),
        ),
      ),

      // Jog controls
      isConnected && React.createElement('div', { style: { padding: '8px 18px' } },
        // Step selector
        React.createElement('div', { style: { display: 'flex', gap: 3, justifyContent: 'center', marginBottom: 6 } },
          ...[1, 10, 50].map(step =>
            React.createElement('button', {
              key: step, onClick: () => setJogStep(step),
              style: {
                padding: '3px 10px', fontSize: 10, fontFamily: mono, cursor: 'pointer',
                background: jogStep === step ? 'rgba(0,212,255,0.1)' : 'transparent',
                border: jogStep === step ? '1px solid #00d4ff' : '1px solid #252540',
                borderRadius: 4, color: jogStep === step ? '#00d4ff' : '#555570',
              },
            }, `${step}mm`),
          ),
        ),
        // Arrow pad + side buttons
        React.createElement('div', { style: { display: 'flex', gap: 4, justifyContent: 'center' } },
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 36px)', gap: 3 } },
            React.createElement('div'),
            React.createElement('button', { onClick: () => handleJog('Y', -jogStep), title: 'Step 2: Move the laser to your workpiece corner', style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '↑'),
            React.createElement('div'),
            React.createElement('button', { onClick: () => handleJog('X', -jogStep), title: 'Step 2: Move the laser to your workpiece corner', style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '←'),
            React.createElement('button', {
              onClick: async () => {
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
              },
              title: 'Step 3: Set this position as the starting point (0,0) — jog here first, then press ZERO',
              style: { ...btnStyle('0,212,255'), padding: '6px', fontSize: 8, fontWeight: 700 },
            }, 'ZERO'),
            React.createElement('button', { onClick: () => handleJog('X', jogStep), title: 'Step 2: Move the laser to your workpiece corner', style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '→'),
            React.createElement('div'),
            React.createElement('button', { onClick: () => handleJog('Y', jogStep), title: 'Step 2: Move the laser to your workpiece corner', style: { ...btnStyle('136,136,170'), padding: '6px', fontSize: 12 } }, '↓'),
            React.createElement('div'),
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 3, marginLeft: 12 } },
            React.createElement('button', { onClick: () => sendCmd('$X'), title: 'Step 1: Clear alarm state so the machine can move', style: { ...btnStyle('255,212,68'), fontSize: 10, padding: '4px 10px' } }, 'Unlock'),
            React.createElement('button', {
              onClick: () => { void handleTestFire(); },
              disabled: !isConnected || isRunning,
              style: {
                padding: '4px 10px', fontSize: 11, cursor: (!isConnected || isRunning) ? 'default' : 'pointer',
                fontFamily: font,
                background: isTestFiring ? 'rgba(255,68,102,0.15)' : 'transparent',
                border: isTestFiring ? '1px solid #ff4466' : '1px solid #252540',
                borderRadius: 5,
                color: isTestFiring ? '#ff4466' : '#c0c0d0',
                animation: isTestFiring ? 'laserforgePulse 1s infinite' : 'none',
                opacity: (!isConnected || isRunning) ? 0.5 : 1,
              },
            }, isTestFiring ? '🔴 Fire OFF' : '🔥 Test Fire'),
            productionMode && React.createElement('button', {
              onClick: async () => {
                const ok = await showConfirm('Homing', 'Homing moves to limit switches. Continue?');
                if (ok) sendCmd('$H');
              },
              style: { ...btnStyle('136,136,170'), fontSize: 10, padding: '4px 10px' },
            }, 'Home'),
          ),
        ),
      ),

      // Time estimate + job buttons
      isConnected && React.createElement('div', { style: { padding: '8px 18px' } },
        gcode && React.createElement('div', {
          style: { padding: '6px 12px', marginBottom: 6, background: '#0a0a14', borderRadius: 6, border: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', fontSize: 11 },
        },
          React.createElement('span', { style: { color: '#8888aa' } }, 'Estimated time'),
          React.createElement('span', { style: { color: '#00d4ff', fontFamily: mono, fontWeight: 600 } }, estimateJobTime(gcode).formatted),
        ),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' as const, gap: 6 } },
          React.createElement('div', { style: { display: 'flex', gap: 6 } },
            React.createElement('button', {
              onClick: () => { void handleFrameSafe(); },
              disabled: !canFrame,
              title: 'Trace the design outline with the laser OFF (safe)',
              style: { ...btnStyle('255,212,68', !canFrame), flex: 1 },
            }, '⬚ Frame (Safe)'),
            React.createElement('button', {
              onClick: () => { void handleFrameDot(); },
              disabled: !canFrame,
              title: 'Trace with low-power laser dot — visible but can scorch wood',
              style: {
                ...btnStyle('255,212,68', !canFrame),
                flex: 1,
                ...(canFrame ? { border: '2px solid rgba(255,212,68,0.55)' } : {}),
              },
            }, '◉ Frame (Laser Dot)'),
          ),
          React.createElement('div', { style: { display: 'flex', gap: 6 } },
            React.createElement('button', {
              onClick: handleProofRun, disabled: !gcode || isRunning,
              title: 'Proof mode: same path, laser off — verify motion before cutting',
              style: { ...btnStyle('136,180,255', !gcode || isRunning), flex: 1 },
            }, 'Proof'),
            React.createElement('button', {
              onClick: handleStartJob, disabled: !gcode || isRunning,
              title: 'Step 5: Begin cutting — make sure you have framed first to verify position',
              style: { ...btnStyle('45,212,160', !gcode || isRunning), flex: 1, fontWeight: 600 },
            }, isRunning ? 'Running...' : `Start Job${isSimulator ? ' (Sim)' : ''}`),
          ),
        ),
        // Pause/Resume/Stop when running
        isRunning && React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
          React.createElement('button', {
            onClick: () => controllerRef.current?.pause(),
            style: { ...btnStyle('255,212,68'), flex: 1 },
          }, 'Pause'),
          React.createElement('button', {
            onClick: () => controllerRef.current?.resume(),
            style: { ...btnStyle('45,212,160'), flex: 1 },
          }, 'Resume'),
          React.createElement('button', {
            onClick: () => controllerRef.current?.stop(),
            style: { ...btnStyle('255,68,102'), flex: 1 },
          }, 'Stop'),
        ),
        // Progress bar
        jobProgress && jobProgress.totalLines > 0 && React.createElement('div', { style: { marginTop: 8 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555570', marginBottom: 3 } },
            React.createElement('span', null, `${jobProgress.linesAcknowledged} / ${jobProgress.totalLines} acknowledged`),
            React.createElement('span', null, `${jobProgress.percentComplete.toFixed(0)}%`),
          ),
          React.createElement('div', { style: { height: 3, background: '#1a1a2e', borderRadius: 2, overflow: 'hidden' } },
            React.createElement('div', { style: { width: `${jobProgress.percentComplete}%`, height: '100%', background: '#00d4ff', borderRadius: 2, transition: 'width 0.1s' } }),
          ),
        ),
      ),

      // Job outcome feedback
      showOutcome && currentReplay && React.createElement('div', {
        style: {
          padding: '12px 18px', background: 'rgba(45,212,160,0.06)',
          borderTop: '1px solid rgba(45,212,160,0.2)', borderBottom: '1px solid rgba(45,212,160,0.2)',
        },
      },
        React.createElement('div', {
          style: { fontSize: 12, fontWeight: 600, color: '#2dd4a0', marginBottom: 8 },
        }, '✓ Job complete — how did it turn out?'),
        React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' as const } },
          ...(['perfect', 'too_dark', 'too_light', 'didnt_cut', 'burned'] as const).map(outcome =>
            React.createElement('button', {
              key: outcome,
              onClick: () => {
                if (currentReplay) {
                  currentReplay.outcome = outcome;
                  saveReplay(currentReplay);

                  // Record for material learning
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
                padding: '6px 12px', fontSize: 11, cursor: 'pointer',
                background: 'rgba(255,255,255,0.03)', border: '1px solid #252540',
                borderRadius: 6, color: '#8888aa', fontFamily: font,
              },
            }, outcome === 'perfect' ? '✓ Perfect' :
               outcome === 'too_dark' ? 'Too dark' :
               outcome === 'too_light' ? 'Too light' :
               outcome === 'didnt_cut' ? "Didn't cut through" :
               'Burned/charred'),
          ),
          React.createElement('button', {
            onClick: () => setShowOutcome(false),
            style: {
              padding: '6px 12px', fontSize: 11, cursor: 'pointer',
              background: 'transparent', border: '1px solid #1a1a2e',
              borderRadius: 6, color: '#555570', fontFamily: font,
            },
          }, 'Skip'),
        ),
      ),

      // Console — full log in Production, simple status in Beginner
      productionMode ? React.createElement('div', {
        ref: logRef,
        style: { flex: 1, minHeight: 80, maxHeight: 140, padding: '8px 12px', margin: '8px 18px', background: '#08080f', borderRadius: 8, border: '1px solid #1a1a2e', overflow: 'auto', fontFamily: mono, fontSize: 10, lineHeight: 1.5 },
      },
        messages.length === 0
          ? React.createElement('span', { style: { color: '#333355' } }, 'Console...')
          : messages.map((msg, i) =>
              React.createElement('div', { key: i, style: { color: msg.startsWith('ERROR') || msg.startsWith('⚠') ? '#ff4466' : msg.startsWith('>') ? '#00d4ff' : msg.startsWith('✓') ? '#2dd4a0' : '#555570' } }, msg),
            ),
      ) : React.createElement('div', {
        style: {
          padding: '8px 18px', fontSize: 11, color: '#555570',
          minHeight: 40, display: 'flex', alignItems: 'center',
        },
      },
        messages.length > 0
          ? React.createElement('span', { style: { color: messages[messages.length - 1].startsWith('✓') ? '#2dd4a0' : messages[messages.length - 1].startsWith('ERROR') ? '#ff4466' : '#8888aa' } },
              messages[messages.length - 1])
          : 'Waiting for connection...',
      ),

      productionMode && React.createElement(JobLogViewer, {
        onLoadLog: (entries: string[]) => setMessages(entries),
        showConfirm,
      }),

      // Manual command — Production mode only
      isConnected && productionMode && React.createElement('div', { style: { padding: '8px 18px 12px', display: 'flex', gap: 6 } },
        React.createElement('input', {
          type: 'text', value: manualCmd, placeholder: 'G-code command...',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setManualCmd(e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') { sendCmd(manualCmd); setManualCmd(''); } },
          style: { flex: 1, padding: '6px 10px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#e0e0ec', fontSize: 11, fontFamily: mono, outline: 'none' },
        }),
        React.createElement('button', { onClick: () => { sendCmd(manualCmd); setManualCmd(''); }, style: btnStyle('0,212,255') }, 'Send'),
      ),

      showSimulator && isSimulator && isConnected && React.createElement('div', {
        style: { height: 300, borderTop: '1px solid #1a1a2e', minHeight: 200 },
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
      ),

      // Footer (scrollable)
      React.createElement('div', {
        style: { padding: '8px 18px', borderTop: '1px solid #1a1a2e', fontSize: 10, color: '#444460' },
      }, 'GRBL 1.1+ · Character-counting buffer · 5Hz status polling'),
      ),

      // Emergency stop — always visible, never scrolls away
      isConnected && React.createElement('div', {
        style: {
          padding: '8px 18px 12px', borderTop: '1px solid #1a1a2e',
          flexShrink: 0,
        },
      },
        React.createElement('button', {
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
            setMessages(prev => [...prev, '⚠ EMERGENCY STOP']);
          },
          style: {
            width: '100%', padding: '10px',
            background: 'rgba(255,68,102,0.15)',
            border: '2px solid #ff4466',
            borderRadius: 6, color: '#ff4466',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
            fontFamily: "'DM Sans', system-ui, sans-serif",
          },
        }, '⚠ EMERGENCY STOP'),
      ),
    ),
  );
}
