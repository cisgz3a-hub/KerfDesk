import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type LaserController } from '../../controllers/ControllerInterface';
import { MockSerialPort, type SerialPortLike } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { WebSocketSerialPort } from '../../communication/WebSocketSerialPort';
import { createSerialPort } from '../../communication/SerialPortFactory';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';
import { type Scene } from '../../core/scene/Scene';
import { type LayerMode, type FillMode } from '../../core/scene/Layer';
import { type PathGeometry, type TextGeometry } from '../../core/scene/SceneObject';
import { textGeometryToPath } from '../../geometry/TextToPath';
import { DeviceProfileSelector } from './DeviceProfileSelector';
import { JobLogViewer } from './JobLogViewer';
import { runPreflightSummary, type PreflightSummary, type PreflightIssue } from '../../core/preflight/Preflight';
import { confirmPreflightForJobStart } from '../../core/preflight/confirmPreflightForJobStart';
import { getActiveProfile, type MachineOriginCorner } from '../../core/devices/DeviceProfile';
import { type MachineService } from '../../app/MachineService';
import { MAX_LASER_SPEED } from '../../core/types';
import { computeGcodeOffset, type GcodeStartMode } from '../../core/output/GcodeOrigin';
import { transformPointToMachine } from '../../core/plan/MachineTransform';
import { SimulatorView } from './SimulatorView';
import { ConnectionControls } from './ConnectionControls';
import { MoveControls } from './MoveControls';
import { JobControls } from './JobControls';
import { ConsolePanel } from './ConsolePanel';
import { StatusBar } from './connection/StatusBar';
import { Jog } from './connection/Jog';
import { Issues } from './connection/Issues';
import { Progress } from './connection/Progress';
import { ConnectWizard } from './connection/ConnectWizard';
import { type SettingsTab } from './SettingsModal';

type StartMode = GcodeStartMode;

const FRAME_IDLE_POLL_MS = 200;
const FRAME_IDLE_TIMEOUT_MS = 15_000;
/** Backup stop if pointer-up is missed (deadman test fire). */
const TEST_FIRE_MAX_MS = 5000;

/** Poll until GRBL reports idle (e.g. after framing moves). */
async function waitForGrblIdle(ctrl: LaserController): Promise<boolean> {
  const deadline = Date.now() + FRAME_IDLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      ctrl.requestStatusReport();
    } catch {
      /* disconnected */
    }
    if (ctrl.state.status === 'idle') return true;
    await new Promise<void>(r => setTimeout(r, FRAME_IDLE_POLL_MS));
  }
  return false;
}

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

export interface ConnectionPanelMainProps {
  controller: LaserController;
  portRef: React.MutableRefObject<SerialPortLike | null>;
  machineState: MachineState | null;
  jobProgress: JobProgress | null;
  scene: Scene;
  gcode: string | null;
  bedWidth: number;
  bedHeight: number;
  /** Machine-space plan bounds for preflight validation (from applyMachineTransform). */
  machinePlanBounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
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
  originCorner: MachineOriginCorner;
  machinePosition: { x: number; y: number } | null;
  onSelectMode: (mode: StartMode) => void;
  onSaveOrigin: () => void;
  gcodeStale?: boolean;
  onRecompile?: () => void;
  onUpdateLayerMode?: (layerId: string, mode: LayerMode) => void;
  onUpdateLayerFillMode?: (layerId: string, fillMode: FillMode) => void;
  onUpdateLayerFillInterval?: (layerId: string, intervalMm: number) => void;
  onUpdateLayerFillBidirectional?: (layerId: string, bidirectional: boolean) => void;
  onUpdateLayerSetting?: (layerId: string, key: 'powerMax' | 'speed' | 'passes', value: number) => void;
  onOpenSettings?: (tab?: SettingsTab) => void;
  /** Panel width in px (host computes min(500, 45% window)). */
  sidebarWidth?: number;
  machineService: MachineService;
  outcomeReplaySection: React.ReactNode;
  messages: string[];
  appendMessage: (message: string) => void;
  replaceMessages: (next: string[] | ((prev: string[]) => string[])) => void;
  clearMessages: () => void;
  isSimulator: boolean;
  setSimulator: (v: boolean) => void;
}

export function ConnectionPanelMain({
  controller,
  portRef,
  machineState,
  jobProgress,
  scene,
  gcode,
  bedWidth,
  bedHeight,
  machinePlanBounds = null,
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
  originCorner,
  machinePosition,
  onSelectMode,
  onSaveOrigin,
  gcodeStale = false,
  onRecompile,
  onUpdateLayerMode,
  onUpdateLayerFillMode,
  onUpdateLayerFillInterval,
  onUpdateLayerFillBidirectional,
  onUpdateLayerSetting,
  onOpenSettings,
  sidebarWidth = 500,
  machineService,
  outcomeReplaySection,
  messages,
  appendMessage,
  replaceMessages,
  clearMessages,
  isSimulator,
  setSimulator,
}: ConnectionPanelMainProps) {
  const [preflight, setPreflight] = useState<PreflightSummary | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [jogStep, setJogStep] = useState(10);
  const [showMore, setShowMore] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [manualCmd, setManualCmd] = useState('');
  const [isTestFiring, setIsTestFiring] = useState(false);
  const isTestFiringRef = useRef(false);
  const testFireTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testFirePointerCaptureRef = useRef<{ pointerId: number; el: HTMLButtonElement } | null>(null);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [completedTime, setCompletedTime] = useState(0);
  const [progressFlashGreen, setProgressFlashGreen] = useState(false);
  const [wifiBridgeHost, setWifiBridgeHost] = useState('localhost');
  const [wifiBridgePort, setWifiBridgePort] = useState('8765');

  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const setMessages = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      if (typeof next === 'function') {
        replaceMessages(next(messages));
      } else {
        replaceMessages(next);
      }
    },
    [messages, replaceMessages],
  );
  const logRef = useRef<HTMLDivElement>(null);
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
    try {
      const host = localStorage.getItem('laserforge_wifi_bridge_host');
      const port = localStorage.getItem('laserforge_wifi_bridge_port');
      if (host) setWifiBridgeHost(host);
      if (port) setWifiBridgePort(port);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      try {
        const api = (window as { electronAPI?: { stopBridge?: () => Promise<void> } }).electronAPI;
        void api?.stopBridge?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    isTestFiringRef.current = isTestFiring;
  }, [isTestFiring]);

  const stopTestFire = useCallback(() => {
    const cap = testFirePointerCaptureRef.current;
    if (cap?.el) {
      try {
        if (cap.el.hasPointerCapture(cap.pointerId)) {
          cap.el.releasePointerCapture(cap.pointerId);
        }
      } catch {
        /* ignore */
      }
    }
    testFirePointerCaptureRef.current = null;

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
  }, [notifySimulatorTx]);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const result = runPreflightSummary(scene, gcode, machineState, bedWidth, bedHeight, machinePlanBounds);
    setPreflight(result);
  }, [gcode, machineState, scene, bedWidth, bedHeight, machinePlanBounds]);

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

    const mock = createSerialPort('simulator', { bedWidth, bedHeight }) as MockSerialPort;
    portRef.current = mock;
    mock.open();
    try {
      await ctrl.connect(mock);
      setSimulator(true);
      appendMessage('✓ Simulator connected');
    } catch (e: any) {
      appendMessage(`Connection failed: ${e.message}`);
    }
  };

  const connectRealLaser = async () => {
    if (!WebSerialPort.isSupported()) {
      appendMessage('ERROR: Web Serial not supported in this browser');
      return;
    }
    try {
      appendMessage('Port opened, waiting for GRBL welcome...');
      await machineService.connectRealLaser(getActiveProfile()?.baudRate ?? 115200);
      setSimulator(false);
      appendMessage('✓ Real laser connected via USB');
    } catch (e: any) {
      appendMessage(`Connection failed: ${e.message}`);
    }
  };

  const connectWifiLaser = async () => {
    console.log('WiFi button clicked');
    const ctrl = controllerRef.current;
    if (!ctrl) {
      appendMessage('ERROR: Controller not ready');
      console.error('WiFi connect: controller missing');
      return;
    }
    const host = wifiBridgeHost.trim() || 'localhost';
    const parsedPort = Number.parseInt(wifiBridgePort.trim(), 10);
    if (!Number.isFinite(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      appendMessage('ERROR: WiFi bridge port must be 1-65535');
      console.warn('WiFi connect: invalid port', wifiBridgePort);
      return;
    }

    const electronAPI = (window as { electronAPI?: { startBridge?: (ip: string, port: number) => Promise<{ ok: boolean; error?: string }> } }).electronAPI;
    if (electronAPI?.startBridge) {
      appendMessage('Starting WiFi bridge...');
      try {
        const result = await electronAPI.startBridge('192.168.0.1', parsedPort);
        if (!result.ok) {
          appendMessage(`Bridge start failed: ${result.error ?? 'unknown error'}`);
          return;
        }
        appendMessage('Bridge started');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        appendMessage(`Bridge start error: ${msg}`);
        console.error('Bridge start failed', e);
        /* Continue anyway — bridge might already be running externally */
      }
    }

    const url = `ws://${host}:${parsedPort}`;
    const wsPort = createSerialPort('websocket') as WebSocketSerialPort;
    portRef.current = wsPort;
    try {
      appendMessage(`Connecting to WiFi bridge ${url} ...`);
      await wsPort.connect(url);
      await ctrl.connect(wsPort);
      try {
        localStorage.setItem('laserforge_wifi_bridge_host', host);
        localStorage.setItem('laserforge_wifi_bridge_port', String(parsedPort));
      } catch {
        /* ignore */
      }
      setSimulator(false);
      const ok = '✓ Connected to laser via WiFi';
      appendMessage(ok);
      console.log(ok);
    } catch (e: unknown) {
      portRef.current = null;
      const msg = e instanceof Error ? e.message : String(e);
      appendMessage(`Connection failed: ${msg}`);
      console.error('WiFi connect failed', e);
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

      stopTestFire();

      notifySimulatorTx('M5 S0');
      try {
        ctrl?.sendCommand('M5 S0');
      } catch {
        /* may already be disconnected */
      }

      try {
        await machineService.disconnect();
      } catch {
        /* ignore */
      }
    } catch {
      /* best effort — still reset local state and close panel */
    }

    portRef.current = null;
    try {
      const api = (window as { electronAPI?: { stopBridge?: () => Promise<void> } }).electronAPI;
      await api?.stopBridge?.();
    } catch {
      /* ignore */
    }
    setShowSimulator(false);
    clearMessages();
    onDisconnect?.();
  }, [stopTestFire, notifySimulatorTx, onDisconnect, machineService, clearMessages]);

  // ─── Machine control ────────────────────────────────────

  const sendCmd = (cmd: string) => {
    notifySimulatorTx(cmd);
    try {
      machineService.sendCommand(cmd);
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
        machineService.jog(axis, distance, feedRate);
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
      }
    },
    [notifySimulatorTx, machineService],
  );

  const handleStartJob = async () => {
    if (!gcode || !controllerRef.current) return;
    setIsPaused(false);
    setJobCompleted(false);

    const okPreflight = await confirmPreflightForJobStart(preflight, showAlert, showConfirm);
    if (!okPreflight) return;

    stopTestFire();

    const lines = gcode.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith(';'));
    setMessages(prev => [...prev, `Starting job: ${lines.length} commands (readiness: ${preflight?.score ?? '?'}%)`]);
    try {
      machineService.beginJobRun({
        lines,
        scene,
        machineState,
        gcodeText: gcode,
        notifySimulatorTx,
      });
      jobStoppedByUserRef.current = false;
      const t0 = Date.now();
      jobStartTimeRef.current = t0;
      setJobStartTime(t0);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
    } catch (e: unknown) {
      machineService.clearJobSession();
      jobStartTimeRef.current = null;
      setJobStartTime(null);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
      setMessages(prev => [...prev, `Failed to start: ${e instanceof Error ? e.message : String(e)}`]);
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
    async (ctrl: LaserController, line: string) => {
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

    const transformOpts = {
      startMode,
      savedOrigin,
      originCorner,
      bedHeightMm: bedHeight,
    };

    const corners = [
      { x: sceneBounds.minX, y: sceneBounds.minY },
      { x: sceneBounds.maxX, y: sceneBounds.minY },
      { x: sceneBounds.maxX, y: sceneBounds.maxY },
      { x: sceneBounds.minX, y: sceneBounds.maxY },
      { x: sceneBounds.minX, y: sceneBounds.minY },
    ].map(p => transformPointToMachine(p, sceneBounds, transformOpts));

    const ys = corners.map(c => c.y);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);

    setMessages(prev => [...prev,
      `Framing (safe): machine X${corners[0].x.toFixed(0)}-${corners[1].x.toFixed(0)} Y${yLo.toFixed(0)}-${yHi.toFixed(0)}`,
    ]);

    const lines: string[] = [
      'G90',
      'G21',
      'M5 S0',
      ...corners.map(c => `G0 X${c.x.toFixed(3)} Y${c.y.toFixed(3)}`),
      'M5 S0',
    ];

    for (const line of lines) {
      await sendFrameLine(ctrl, line);
    }

    const idleOk = await waitForGrblIdle(ctrl);
    if (!idleOk) {
      setMessages(prev => [...prev, '⚠ Frame (Safe): machine did not reach idle within 15s — check machine state']);
      return;
    }

    hasFramed.current = true;
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Safe) complete']);
  }, [canFrame, confirmFrameBounds, sceneBounds, startMode, savedOrigin, originCorner, bedHeight, sendFrameLine]);

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

    const transformOpts = {
      startMode,
      savedOrigin,
      originCorner,
      bedHeightMm: bedHeight,
    };

    const corners = [
      { x: sceneBounds.minX, y: sceneBounds.minY },
      { x: sceneBounds.maxX, y: sceneBounds.minY },
      { x: sceneBounds.maxX, y: sceneBounds.maxY },
      { x: sceneBounds.minX, y: sceneBounds.maxY },
      { x: sceneBounds.minX, y: sceneBounds.minY },
    ].map(p => transformPointToMachine(p, sceneBounds, transformOpts));

    const ys = corners.map(c => c.y);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);

    setMessages(prev => [...prev,
      `Framing (laser dot): machine X${corners[0].x.toFixed(0)}-${corners[1].x.toFixed(0)} Y${yLo.toFixed(0)}-${yHi.toFixed(0)}`,
    ]);

    const maxSpindle = getActiveProfile()?.maxSpindle ?? 1000;
    const frameDotS = Math.max(0, Math.round(0.005 * maxSpindle));

    const lines: string[] = [
      'G90', 'G21',
      // M4 = dynamic laser mode — fires during G1/G2/G3 only; correct while machine moves along frame
      `M4 S${frameDotS}`,
      ...corners.map(c => `G1 X${c.x.toFixed(3)} Y${c.y.toFixed(3)} F3000`),
      'M5 S0',
    ];

    for (const line of lines) {
      await sendFrameLine(ctrl, line);
    }

    const idleOk = await waitForGrblIdle(ctrl);
    if (!idleOk) {
      setMessages(prev => [...prev, '⚠ Frame (Laser Dot): machine did not reach idle within 15s — check machine state']);
      return;
    }

    hasFramed.current = true;
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Laser Dot) complete']);
  }, [canFrame, confirmFrameBounds, sceneBounds, startMode, savedOrigin, originCorner, bedHeight, sendFrameLine]);

  const handleZero = useCallback(async () => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    if (machineState?.status === 'alarm') {
      await showAlert(
        'Machine in alarm',
        'Unlock the machine (Clear alarm / $X) before setting work zero.',
      );
      return;
    }
    try {
      sendCmd('G10 L20 P1 X0 Y0');
      ctrl.requestStatusReport();
      hasZeroed.current = true;
      setWorkflowVersion(v => v + 1);
      setMessages(prev => [...prev, '✓ Work origin set at current position — matches “Where Head Is” G-code mode']);
    } catch {
      setMessages(prev => [...prev, 'Zero failed — try again']);
    }
  }, [machineState?.status, showAlert]);

  const handleHome = useCallback(async () => {
    const ok = await showConfirm('Homing', 'Homing moves to limit switches. Continue?');
    if (ok) sendCmd('$H');
  }, [showConfirm]);

  const handleUnlock = useCallback(() => {
    sendCmd('$X');
  }, []);

  const handlePauseResume = useCallback(async () => {
    const held = isPaused || machineState?.status === 'hold';
    try {
      machineService.pauseResume(held);
      setIsPaused(!held);
    } catch (err: unknown) {
      console.warn('[Pause/Resume]', err instanceof Error ? err.message : err);
    }
  }, [isPaused, machineState?.status, machineService]);

  const handleStop = useCallback(async () => {
    jobStoppedByUserRef.current = true;
    try {
      await machineService.stopAndEnsureLaserOff(notifySimulatorTx);
      // Do NOT auto-send $X — leave machine in alarm/lock state
      // so operator can inspect before unlocking manually
      setIsPaused(false);
    } catch (err: unknown) {
      console.warn('[Stop]', err instanceof Error ? err.message : err);
    }
  }, [notifySimulatorTx, machineService]);

  /** Deadman: laser is on only while primary pointer is held on the button. */
  const beginTestFire = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const ctrl = controllerRef.current;
      if (!ctrl || isTestFiringRef.current) return;
      if (machineState?.status === 'alarm') return;

      const acknowledged = localStorage.getItem('laserforge_testfire_acknowledged');
      if (!acknowledged) {
        const ok = confirm(
          '⚠ Test Fire enables the laser at low power (2% of your machine\'s max spindle / S range).\n\n' +
          'Hold the button to fire — release to stop (5 second safety limit).\n\n' +
          'Make sure:\n' +
          '• Eye protection is on\n' +
          '• Nothing flammable directly under the laser\n\n' +
          'After OK, press and hold the button again to test fire.',
        );
        if (!ok) return;
        localStorage.setItem('laserforge_testfire_acknowledged', 'true');
        return;
      }

      const maxSpindle = getActiveProfile()?.maxSpindle ?? 1000;
      const sVal = Math.max(0, Math.round((2 / 100) * maxSpindle));
      const cmd = `M3 S${sVal}`;

      if (testFireTimeoutRef.current) {
        clearTimeout(testFireTimeoutRef.current);
        testFireTimeoutRef.current = null;
      }

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      try {
        notifySimulatorTx(cmd);
        ctrl.sendCommand(cmd);
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }

      testFirePointerCaptureRef.current = { pointerId: e.pointerId, el: e.currentTarget };
      setIsTestFiring(true);
      testFireTimeoutRef.current = setTimeout(() => {
        testFireTimeoutRef.current = null;
        stopTestFire();
      }, TEST_FIRE_MAX_MS);
    },
    [machineState?.status, notifySimulatorTx, stopTestFire],
  );

  const endTestFire = useCallback(() => {
    stopTestFire();
  }, [stopTestFire]);

  useEffect(() => {
    return () => {
      stopTestFire();
    };
  }, [stopTestFire]);

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

  const posX = machinePosition?.x ?? machineState?.position.x;
  const posY = machinePosition?.y ?? machineState?.position.y;
  const canStartJob = !!gcode && !isRunning && !!preflight?.canStart && !gcodeStale;
  /** Human-readable reason the Start button is disabled, or null if ready. */
  const startDisabledReason: string | null = (() => {
    if (isRunning) return null; // button is replaced with Pause/Stop; not relevant
    if (!gcode) return 'Click G-code in the toolbar to compile this design';
    if (gcodeStale) return 'Design changed - click ↻ Update above';
    if (!preflight?.canStart) return 'Fix the issues listed below first';
    return null; // ready to start
  })();
  void workflowVersion;

  const statusSection = React.createElement(StatusBar, {
    isConnected,
    isSimulator,
    status: machineState?.status ?? null,
    posX,
    posY,
    onClose,
  });

  const connectSection = React.createElement(ConnectWizard, {
    webSerialSupported: WebSerialPort.isSupported(),
    wifiBridgeHost,
    setWifiBridgeHost,
    wifiBridgePort,
    setWifiBridgePort,
    onConnectUsb: () => { void connectRealLaser(); },
    onConnectWifi: () => { void connectWifiLaser(); },
    onConnectSimulator: () => { void connectSimulator(); },
  });

  const step1Done = hasZeroed.current;
  const step3Done = hasFramed.current;
  const startJobDesc = canStartJob
    ? 'Ready to cut!'
    : isRunning
      ? 'Running'
      : !gcode
        ? 'Compile G-code first'
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
    React.createElement(Jog, {
      jogStep,
      setJogStep,
      onJog: handleJog,
      onHome: () => { void handleHome(); },
    }),
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
        onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
          e.preventDefault();
          beginTestFire(e);
        },
        onPointerUp: () => { endTestFire(); },
        onPointerLeave: () => {
          if (isTestFiringRef.current) endTestFire();
        },
        onPointerCancel: () => { endTestFire(); },
        disabled: machineState?.status === 'alarm' || isRunning,
        title: isTestFiring
          ? 'Release to stop laser (deadman)'
          : 'Hold to fire at 2% of machine max S — release to stop',
        style: {
          width: '100%', padding: '7px', fontSize: 11, fontWeight: 600, borderRadius: 6,
          cursor: machineState?.status === 'alarm' || isRunning ? 'default' : 'pointer', fontFamily: font,
          background: isTestFiring ? 'rgba(255,68,102,0.15)' : 'rgba(255,68,102,0.05)',
          border: isTestFiring ? '1px solid #ff4466' : '1px solid rgba(255,68,102,0.2)',
          color: isTestFiring ? '#ff4466' : '#ff6680',
          opacity: machineState?.status === 'alarm' || isRunning ? 0.4 : 1,
          animation: isTestFiring ? 'laserforgePulse 1s infinite' : 'none',
          touchAction: 'none',
          userSelect: 'none',
        } as React.CSSProperties,
      }, isTestFiring ? '🔴 FIRING — Release to stop' : '🔥 Test Fire (hold)'),
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
        onUpdateLayerSetting && React.createElement('div', {
          style: { display: 'flex', gap: 6, marginTop: 6 },
        },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 8, color: '#555570', marginBottom: 2 } }, 'Power %'),
            React.createElement('input', {
              type: 'number',
              value: layer.settings.power.max,
              min: 0,
              max: 100,
              step: 5,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdateLayerSetting(layer.id, 'powerMax', parseInt(e.target.value, 10) || 0);
              },
              style: {
                width: '100%',
                padding: '5px 6px',
                fontSize: 11,
                fontFamily: mono,
                background: '#0a0a14',
                border: '1px solid #252540',
                borderRadius: 4,
                color: '#e0e0ec',
                textAlign: 'center' as const,
              },
            }),
          ),
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { fontSize: 8, color: '#555570', marginBottom: 2 } }, 'Speed mm/min'),
            React.createElement('input', {
              type: 'number',
              value: layer.settings.speed,
              min: 10,
              max: MAX_LASER_SPEED,
              step: 100,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdateLayerSetting(layer.id, 'speed', parseInt(e.target.value, 10) || 1000);
              },
              style: {
                width: '100%',
                padding: '5px 6px',
                fontSize: 11,
                fontFamily: mono,
                background: '#0a0a14',
                border: '1px solid #252540',
                borderRadius: 4,
                color: '#e0e0ec',
                textAlign: 'center' as const,
              },
            }),
          ),
          React.createElement('div', { style: { flex: 0.6 } },
            React.createElement('div', { style: { fontSize: 8, color: '#555570', marginBottom: 2 } }, 'Passes'),
            React.createElement('input', {
              type: 'number',
              value: layer.settings.passes,
              min: 1,
              max: 99,
              step: 1,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                onUpdateLayerSetting(layer.id, 'passes', parseInt(e.target.value, 10) || 1);
              },
              style: {
                width: '100%',
                padding: '5px 6px',
                fontSize: 11,
                fontFamily: mono,
                background: '#0a0a14',
                border: '1px solid #252540',
                borderRadius: 4,
                color: '#e0e0ec',
                textAlign: 'center' as const,
              },
            }),
          ),
        ),
        onUpdateLayerSetting && React.createElement('div', { style: { marginTop: 4 } },
          React.createElement('input', {
            type: 'range',
            min: 0,
            max: 100,
            step: 5,
            value: layer.settings.power.max,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
              onUpdateLayerSetting(layer.id, 'powerMax', parseInt(e.target.value, 10));
            },
            style: { width: '100%', accentColor: modeColor, height: 4 },
          }),
        ),
        // ── Text spacing controls (text objects + converted paths with sourceText) ──
        (() => {
          const textObjs = scene.objects.filter(o => o.layerId === layer.id && o.visible && o.geometry.type === 'text');
          const convertedPaths = scene.objects.filter(o =>
            o.layerId === layer.id && o.visible &&
            o.geometry.type === 'path' && (o.geometry as PathGeometry).sourceText,
          );
          if (textObjs.length === 0 && convertedPaths.length === 0) return null;

          // Get spacing values from text objects first, then from converted paths
          const sourceGeom: TextGeometry | undefined =
            textObjs.length > 0
              ? (textObjs[0].geometry as TextGeometry)
              : (convertedPaths[0].geometry as PathGeometry).sourceText;
          if (!sourceGeom) return null;

          const wordSp = sourceGeom.wordSpacing ?? 100;
          const letterSp = sourceGeom.letterSpacing ?? 0;
          const isConverted = textObjs.length === 0; // only converted paths, no live text

          // Update spacing on live text objects (instant canvas feedback)
          const updateLiveText = (prop: 'wordSpacing' | 'letterSpacing', value: number) => {
            onSceneCommit({
              ...scene,
              objects: scene.objects.map(o => {
                if (o.layerId !== layer.id || o.geometry.type !== 'text') return o;
                return {
                  ...o,
                  geometry: { ...o.geometry, [prop]: value },
                  _bounds: null,
                  _worldTransform: null,
                };
              }),
            });
          };

          // Update spacing on converted path sourceText (stored for reconversion)
          const updateConvertedSpacing = (prop: 'wordSpacing' | 'letterSpacing', value: number) => {
            onSceneCommit({
              ...scene,
              objects: scene.objects.map(o => {
                if (o.layerId !== layer.id || o.geometry.type !== 'path') return o;
                const pg = o.geometry as PathGeometry;
                if (!pg.sourceText) return o;
                return {
                  ...o,
                  geometry: { ...pg, sourceText: { ...pg.sourceText, [prop]: value } },
                  _bounds: null,
                  _worldTransform: null,
                };
              }),
            });
          };

          const updateSpacing = (prop: 'wordSpacing' | 'letterSpacing', value: number) => {
            if (textObjs.length > 0) updateLiveText(prop, value);
            if (convertedPaths.length > 0) updateConvertedSpacing(prop, value);
          };

          // Re-convert paths from stored sourceText with updated spacing
          const handleReconvert = async () => {
            const newObjects = [...scene.objects];
            for (let i = 0; i < newObjects.length; i++) {
              const o = newObjects[i];
              if (o.layerId !== layer.id || o.geometry.type !== 'path') continue;
              const pg = o.geometry as PathGeometry;
              if (!pg.sourceText) continue;
              const result = await textGeometryToPath(pg.sourceText);
              if (!result) continue;
              newObjects[i] = {
                ...o,
                geometry: { type: 'path', subPaths: result.subPaths, sourceText: pg.sourceText },
                _bounds: null,
                _worldTransform: null,
              };
            }
            onSceneCommit({ ...scene, objects: newObjects });
          };

          const label = textObjs.length > 0
            ? `TEXT SPACING (${textObjs.length} text)`
            : `TEXT SPACING (${convertedPaths.length} converted)`;

          return React.createElement('div', {
            style: { marginTop: 8, padding: '8px 0 2px', borderTop: '1px solid #1a1a2e' },
          },
            React.createElement('div', {
              style: { fontSize: 9, color: '#00d4ff', marginBottom: 6, fontWeight: 600 },
            }, label),
            // Word spacing
            React.createElement('div', {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
            },
              React.createElement('span', { style: { fontSize: 9, color: '#8888aa' } }, 'Word spacing'),
              React.createElement('span', { style: { fontSize: 9, color: '#00d4ff', fontFamily: mono } }, `${wordSp}%`),
            ),
            React.createElement('input', {
              type: 'range',
              min: 50,
              max: 400,
              step: 10,
              value: wordSp,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                updateSpacing('wordSpacing', parseInt(e.target.value, 10));
              },
              style: { width: '100%', accentColor: '#00d4ff', height: 4, marginBottom: 6 },
            }),
            // Letter spacing
            React.createElement('div', {
              style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
            },
              React.createElement('span', { style: { fontSize: 9, color: '#8888aa' } }, 'Letter spacing'),
              React.createElement('span', { style: { fontSize: 9, color: '#00d4ff', fontFamily: mono } }, `${letterSp}%`),
            ),
            React.createElement('input', {
              type: 'range',
              min: -20,
              max: 100,
              step: 2,
              value: letterSp,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                updateSpacing('letterSpacing', parseInt(e.target.value, 10));
              },
              style: { width: '100%', accentColor: '#00d4ff', height: 4 },
            }),
            // Re-convert button for converted paths
            isConverted && React.createElement('button', {
              type: 'button',
              onClick: () => { void handleReconvert(); },
              style: {
                marginTop: 8, width: '100%', padding: '6px 0',
                background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.25)',
                borderRadius: 4, color: '#00d4ff', fontSize: 10, fontWeight: 600,
                cursor: 'pointer', fontFamily: "'DM Sans', system-ui, sans-serif",
              },
            }, '↺ Apply spacing & re-convert'),
          );
        })(),
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

  const issuesSection = isConnected && !isRunning && !displayPaused && React.createElement(Issues, {
    issues,
    readinessScore,
  });

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
    outcomeReplaySection,
  );

  const jobProgressSection = isConnected && (isRunning || displayPaused) && React.createElement(Progress, {
    jobProgress,
    displayPaused,
    elapsedSeconds,
    estimatedRemaining,
  });

  const footerSection = isConnected && React.createElement('div', {
    style: {
      padding: '10px 16px',
      borderTop: '1px solid #1a1a2e',
      background: '#0d0d18',
      flexShrink: 0,
    },
  },
    !isRunning && !displayPaused && React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
    },
      React.createElement('div', {
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
      startDisabledReason && React.createElement('div', {
        style: {
          fontSize: 10,
          color: '#ffd444',
          textAlign: 'center' as const,
          padding: '4px 8px',
          background: 'rgba(255,212,68,0.06)',
          border: '1px solid rgba(255,212,68,0.2)',
          borderRadius: 6,
          fontFamily: font,
        },
      }, startDisabledReason),
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
        onOpenSettings,
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
        width: sidebarWidth,
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
      React.createElement(ConnectionControls, {
        isConnected,
        statusSection,
        connectSection,
      }),
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
        React.createElement(MoveControls, {
          isConnected,
          isRunning,
          displayPaused,
          workflowSection,
          controlsSection,
          layerOverviewSection,
          gcodeWarning,
          issuesSection,
          outcomeExtrasSection,
        }),
        React.createElement(ConsolePanel, {
          isConnected,
          moreSection,
          simulatorView,
        }),
      ),
      React.createElement(JobControls, {
        isConnected,
        isRunning,
        displayPaused,
        jobProgressSection,
        footerSection,
      }),
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
            stopTestFire();
            controllerRef.current?.emergencyStop();
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
