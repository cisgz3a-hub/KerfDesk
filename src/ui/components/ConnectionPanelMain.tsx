import React, { useState, useEffect, useRef, useCallback, useMemo, type MutableRefObject } from 'react';
import { type LaserController } from '../../controllers/ControllerInterface';
import { MockSerialPort, type SerialPortLike } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { createSerialPort } from '../../communication/SerialPortFactory';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';
import { type Scene } from '../../core/scene/Scene';
import { type LayerMode, type FillMode } from '../../core/scene/Layer';
import { type PathGeometry, type TextGeometry } from '../../core/scene/SceneObject';
import { textGeometryToPath } from '../../geometry/TextToPath';
import { DeviceProfileSelector } from './DeviceProfileSelector';
import { JobLogViewer } from './JobLogViewer';
import { runPreflightSummary, type PreflightSummary } from '../../core/preflight/Preflight';
import {
  confirmPreflightForJobStart,
} from '../../core/preflight/confirmPreflightForJobStart';
import type { ValidatedJobTicket } from '../../core/job/ValidatedJobTicket';
import { type DeviceProfile, type MachineOriginCorner } from '../../core/devices/DeviceProfile';
import { GRBL_USER_LINE_FOR_UNLOCK_CLASSIFY } from '../../core/grbl/grblClassifierLines';
import { type MachineService, type LaserOutputState, type ApprovalToken } from '../../app/MachineService';
import { computeCommandGates } from '../../app/computeCommandGates';
import { getUnsafePriorState } from '../../app/unsafePriorState';
import { computeFrameFreshnessKey } from '../../app/computeFrameFreshnessKey';
import { ExecutionCoordinator } from '../../app/ExecutionCoordinator';
import { type CompileGcodeResult } from '../../app/PipelineService';
import { buildFrameCorners } from '../../app/frameGcode';
import {
  verifySavedOriginG54,
  describeSavedOriginDrift,
} from '../../app/savedOriginVerify';
import { estimateFrameIdleTimeoutMs } from '../../app/grblIdlePoll';
import { MAX_LASER_SPEED } from '../../core/types';
import { computeGcodeOffset, type GcodeStartMode } from '../../core/output/GcodeOrigin';
import { SimulatorView } from './SimulatorView';
import { ConnectionControls } from './ConnectionControls';
import { MoveControls } from './MoveControls';
import { JobControls } from './JobControls';
import { ConsolePanel } from './ConsolePanel';
import { LaserModeBanner } from './LaserModeBanner';
import { StatusBar } from './connection/StatusBar';
import { Jog } from './connection/Jog';
import { Issues } from './connection/Issues';
import { Progress } from './connection/Progress';
import { jobModePlanSummary } from './connection/jobModePlanSummary';
import { ConnectWizard } from './connection/ConnectWizard';
import { Controls } from './connection/Controls';
import type { StartReadiness, StartReadinessGate } from './connection/StartReadinessPanel';
import { Workflow } from './connection/Workflow';
import { MachineControls } from './connection/MachineControls';
import { type SettingsTab } from './SettingsModal';
import { type SafetyState } from '../../app/SafetyStateMachine';
import { RecoveryCard } from '../recovery/RecoveryCard';
import { buildRecoveryCard, type RecoveryAction } from '../recovery/RecoveryCardContent';

function jobModeLabel(scene: Scene): string {
  const outputLayers = scene.layers.filter(l => l.visible && l.output !== false);
  const hasObjectsByLayer = new Set(
    scene.objects.filter(o => o.visible).map(o => o.layerId),
  );
  const contributing = outputLayers.filter(l => hasObjectsByLayer.has(l.id));

  if (contributing.length === 0) return 'Running';

  const modes = new Set(contributing.map(l => l.settings.mode));
  if (modes.size > 1) return 'Running';

  const onlyMode = modes.values().next().value as LayerMode;
  switch (onlyMode) {
    case 'cut': return 'Cutting';
    case 'engrave': return 'Engraving';
    case 'score': return 'Scoring';
    case 'image': return 'Engraving';
    default: return 'Running';
  }
}


type StartMode = GcodeStartMode;

/** Keep streaming-health banner visible briefly after status recovers (reduces flicker). */
const STREAMING_WARNING_HOLD_MS = 3000;

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

function samePreflightSummary(a: PreflightSummary, b: PreflightSummary): boolean {
  if (
    a.score !== b.score ||
    a.canStart !== b.canStart ||
    a.blockers !== b.blockers ||
    a.warnings !== b.warnings
  ) {
    return false;
  }
  if (a.validatedTicket?.ticketId !== b.validatedTicket?.ticketId) return false;
  const ia = a.issues;
  const ib = b.issues;
  if (ia.length !== ib.length) return false;
  for (let i = 0; i < ia.length; i++) {
    const x = ia[i];
    const y = ib[i];
    if (
      x.id !== y.id ||
      x.severity !== y.severity ||
      x.category !== y.category ||
      x.title !== y.title ||
      x.detail !== y.detail ||
      x.fix !== y.fix
    ) {
      return false;
    }
  }
  return true;
}

function sameMessages(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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
  /** Latest compile ticket (phase 1: threaded for confirm only; job path unchanged). */
  compiledJobTicket?: ValidatedJobTicket | null;
  /** Last successful `compileGcode` result (same run as the ticket) — used for T1-11 canvas snapshot. */
  lastGcodeCompileResult?: CompileGcodeResult | null;
  boundsMinX?: number;
  boundsMinY?: number;
  boundsMaxX?: number;
  boundsMaxY?: number;
  onClose: () => void;
  /**
   * Active device profile (memoized in App; re-reads when profileRevision increments).
   * Null if no profile is selected.
   */
  activeProfile: DeviceProfile | null;
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
  /**
   * T1-75: increments when App.tsx applies an undo/redo. The panel watches
   * this counter via an effect that resets `hasFramed` (the burn bounds may
   * have changed, so the previous frame action no longer reflects the
   * current scene). Initial value 0 from App.tsx.
   */
  historyVersion?: number;
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
  /** Shared with App (save origin, etc.); simulator notify ref is wired in an effect. */
  executionCoordinator: ExecutionCoordinator;
  coordinatorSimulatorNotifyRef: MutableRefObject<(line: string) => void>;
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
  compiledJobTicket = null,
  lastGcodeCompileResult = null,
  boundsMinX,
  boundsMinY,
  boundsMaxX,
  boundsMaxY,
  onClose,
  activeProfile,
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
  historyVersion = 0,
  onRecompile,
  onUpdateLayerMode,
  onUpdateLayerFillMode,
  onUpdateLayerFillInterval,
  onUpdateLayerFillBidirectional,
  onUpdateLayerSetting,
  onOpenSettings,
  sidebarWidth = 500,
  machineService,
  executionCoordinator,
  coordinatorSimulatorNotifyRef,
  outcomeReplaySection,
  messages,
  appendMessage,
  replaceMessages,
  clearMessages,
  isSimulator,
  setSimulator,
}: ConnectionPanelMainProps) {
  const [preflight, setPreflight] = useState<PreflightSummary | null>(null);
  const preflightRef = useRef<PreflightSummary | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [jogStep, setJogStep] = useState(10);
  const [showMore, setShowMore] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [manualCmd, setManualCmd] = useState('');
  const [isTestFiring, setIsTestFiring] = useState(false);
  const isTestFiringRef = useRef(false);
  const testFirePointerCaptureRef = useRef<{ pointerId: number; el: HTMLButtonElement } | null>(null);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [jobCompleted, setJobCompleted] = useState(false);
  const [completedTime, setCompletedTime] = useState(0);
  const [isAutoFocusing, setIsAutoFocusing] = useState(false);
  const [progressFlashGreen, setProgressFlashGreen] = useState(false);
  const [streamingLastUnhealthyAt, setStreamingLastUnhealthyAt] = useState<number | null>(null);
  const [safetyState, setSafetyState] = useState<SafetyState>(() => machineService.getSafetyState());
  const [connectionRecoveryVisible, setConnectionRecoveryVisible] = useState(false);
  const [frameRecoveryTimeoutSec, setFrameRecoveryTimeoutSec] = useState<number | null>(null);
  // T1-50 Part A: UI mutex on Connect button. Without this, two
  // rapid clicks each call into `machineService.connectRealLaser()`,
  // each constructing a new WebSerialPort and racing on
  // `requestAndOpen` / `controller.connect`. The first wins; the
  // second's port stays opened and unowned. Mutex disables the
  // button while a connect is in flight; UI shows "Connecting…".
  // (Part B — abortable connect via AbortSignal through MachineService
  // — remains the future safety-path work.)
  const [connecting, setConnecting] = useState(false);

  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const setMessages = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      replaceMessages(prev => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        return sameMessages(prev, resolved) ? prev : resolved;
      });
    },
    [replaceMessages],
  );
  const setMessagesRef = useRef(setMessages);
  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);
  const logRef = useRef<HTMLDivElement>(null);
  const simulatorListenersRef = useRef(new Set<(line: string) => void>());
  const jobStartTimeRef = useRef<number | null>(null);
  const jobProgressRef = useRef<JobProgress | null>(null);
  const elapsedSecondsRef = useRef(0);
  const jobStoppedByUserRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const hasFramed = useRef(false);

  // T1-97 retire (2026-05-02): frame-before-start bypass override removed.
  // The underlying defect that made it necessary was structurally fixed by
  // T1-98 (dynamic frame idle timeout) + T1-99 (savedOrigin no longer
  // compile-invalidating) + T1-100 (machinePlanBounds source uses
  // lastResult). See docs/ROADMAP-shipped-audit.md T1-97 row for the
  // historical record.

  const hasJogged = useRef(false);
  const hasSetOrigin = useRef(false);
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

  useEffect(() => {
    coordinatorSimulatorNotifyRef.current = notifySimulatorTx;
  }, [notifySimulatorTx, coordinatorSimulatorNotifyRef]);

  const onSimulatorSubscribe = useCallback((cb: (line: string) => void) => {
    simulatorListenersRef.current.add(cb);
    return () => {
      simulatorListenersRef.current.delete(cb);
    };
  }, []);

  useEffect(() => {
    setMessages([]);
    setShowSimulator(false);
    // Mount-only reset for panel-local view state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    isTestFiringRef.current = isTestFiring;
  }, [isTestFiring]);

  useEffect(() => {
    setSafetyState(machineService.getSafetyState());
    return machineService.onSafetyStateChange(setSafetyState);
  }, [machineService]);

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

    // T1-18: deadman timer is owned by ExecutionCoordinator. UI just requests stop.
    void executionCoordinator.endTestFire();
    setIsTestFiring(false);
  }, [executionCoordinator]);

  const font = "'DM Sans', system-ui, sans-serif";
  const mono = "'JetBrains Mono', monospace";

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const preflightMachinePresent = machineState != null;
  const preflightMachineStatus = machineState?.status ?? null;
  const preflightMachineAlarm = machineState?.alarmCode ?? null;
  const preflightPlanMinX = machinePlanBounds?.minX ?? null;
  const preflightPlanMinY = machinePlanBounds?.minY ?? null;
  const preflightPlanMaxX = machinePlanBounds?.maxX ?? null;
  const preflightPlanMaxY = machinePlanBounds?.maxY ?? null;
  const preflightGcodeHeaderTemplate = activeProfile?.gcodeHeaderTemplate ?? null;

  useEffect(() => {
    const ctrlMaxSpindle = controllerRef.current?.maxSpindle;
    const unsafeAtConnect = controllerRef.current?.getUnsafeAtConnect?.();
    const result = runPreflightSummary(
      scene,
      gcode,
      machineState,
      bedWidth,
      bedHeight,
      machinePlanBounds,
      controllerRef.current?.getFirmwareHomingCycleEnabled?.(),
      controllerRef.current?.getFirmwareLaserModeEnabled?.(),
      typeof ctrlMaxSpindle === 'number' && ctrlMaxSpindle > 0 ? ctrlMaxSpindle : undefined,
      unsafeAtConnect != null ? unsafeAtConnect.reason : null,
    );
    const next: PreflightSummary =
      compiledJobTicket != null ? { ...result, validatedTicket: compiledJobTicket } : result;
    if (preflightRef.current != null && samePreflightSummary(preflightRef.current, next)) {
      return;
    }
    preflightRef.current = next;
    setPreflight(next);
  }, [
    scene,
    gcode,
    machineState,
    preflightMachinePresent,
    preflightMachineStatus,
    preflightMachineAlarm,
    bedWidth,
    bedHeight,
    machinePlanBounds,
    preflightPlanMinX,
    preflightPlanMinY,
    preflightPlanMaxX,
    preflightPlanMaxY,
    preflightGcodeHeaderTemplate,
    compiledJobTicket,
  ]);

  const isConnected = machineState?.status !== 'disconnected' && machineState?.status !== 'connecting' && machineState !== null;
  const isRunning = controllerRef.current?.isJobRunning || false;
  const displayPaused = isPaused || machineState?.status === 'hold';
  const showAutoFocus = activeProfile?.autoFocusSupported === true;

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      intentionalDisconnectRef.current = false;
      setConnectionRecoveryVisible(false);
      return;
    }

    if (wasConnectedRef.current && !intentionalDisconnectRef.current) {
      setConnectionRecoveryVisible(true);
    }
    wasConnectedRef.current = false;
    intentionalDisconnectRef.current = false;
  }, [isConnected]);

  // T1-30: centralized command-gate computation. Replaces ~ten ad-hoc
  // `isConnected && !isRunning && status === 'idle'` checks scattered
  // across this component with reads from a single helper. Each gate
  // AND-combines five state inputs:
  //   - machineState.status === 'idle' (T1-22)
  //   - laserOutputState === 'off' (T1-22, alarm/run blocks too)
  //   - activeOperation === null (T2-11 mutex layer)
  //   - state.errorCode == null (T1-24)
  //   - !recoveryPending (T1-29 unsafe-prior-state flag dismissed)
  //
  // The mutex (T2-11) is the safety net — even if the gate reads stale
  // because activeOperation transitioned between renders, the mutex
  // layer refuses the actual operation. Gates are the UX surface that
  // prevents the user from clicking buttons that would just bounce off
  // the mutex anyway.
  //
  // `activeOperation` and `recoveryPending` are read inline (not from
  // React state) because their transitions are driven by machineState
  // changes (which already trigger re-renders) or by long-lived modals
  // that block UI input directly. Future work may add an explicit
  // subscription if non-modal recovery surfaces (T3-91) need it.
  const gates = machineState
    ? computeCommandGates({
        state: machineState,
        laserOutput: machineService.getLaserOutputState(),
        activeOperation: machineService.getActiveOperation(),
        recoveryPending: getUnsafePriorState() != null,
      })
    : null;
  const canAutoFocus = gates?.baseSafe ?? false;

  useEffect(() => {
    if (isConnected) {
      hasFramed.current = false;
      hasJogged.current = false;
      hasSetOrigin.current = false;
      setWorkflowVersion(v => v + 1);
    }
  }, [isConnected]);

  // T1-75 (origin) + T2-76 step 3 (extension): historyVersion bumps on
  // any scene mutation App.tsx commits — both undo/redo via
  // applyHistoryScene and edits via the unified commitSceneTransaction
  // (handleSceneCommit, etc.). Burn bounds may have changed; the
  // previous frame action no longer reflects reality. Reset hasFramed
  // so the T1-59 frame-before-start gate refuses Start until the user
  // re-frames. workflowVersion bumped so canStartJob re-evaluates the
  // same render.
  // Mount-time fire (historyVersion === 0) is a no-op since hasFramed
  // is already false.
  useEffect(() => {
    hasFramed.current = false;
    setWorkflowVersion(v => v + 1);
  }, [historyVersion]);

  // T2-60: frame freshness invalidation. The previous-frame motion no
  // longer represents what the laser will burn when ANY of these
  // change: startMode, savedOrigin numeric values, active profile
  // (different originCorner / bed size), bed dimensions (live $130/
  // $131 from auto-detect), originCorner toggle, or compiledTicketId
  // (a fresh compile may move bounds). historyVersion above already
  // covers scene mutations; isConnected covers connect/disconnect;
  // this effect closes the remaining gates the audit (4B Section 8.3)
  // identified.
  //
  // The freshness key is computed from a pure helper so the input set
  // is testable in isolation. The useEffect dep array carries the
  // individual values rather than the key string itself — React's
  // shallow-equality dep comparison fires per individual change,
  // preserving "no extra render when nothing changed."
  const compiledTicketIdForFreshness = compiledJobTicket?.ticketId ?? null;
  const profileIdForFreshness = activeProfile?.id ?? null;
  const frameFreshnessKey = computeFrameFreshnessKey({
    startMode,
    savedOriginX: savedOrigin?.x ?? null,
    savedOriginY: savedOrigin?.y ?? null,
    profileId: profileIdForFreshness,
    bedWidth,
    bedHeight,
    originCorner,
    compiledTicketId: compiledTicketIdForFreshness,
  });
  const lastFrameKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Invalidate only when the key actually changes from the last
    // observed value. Mount-time fire sets the ref but doesn't reset
    // hasFramed (it was already false at mount).
    if (lastFrameKeyRef.current !== null && lastFrameKeyRef.current !== frameFreshnessKey) {
      hasFramed.current = false;
      setWorkflowVersion(v => v + 1);
    }
    lastFrameKeyRef.current = frameFreshnessKey;
  }, [frameFreshnessKey]);

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
    if (!isRunning && !displayPaused) {
      setStreamingLastUnhealthyAt(null);
      return;
    }
    const h = jobProgress?.healthStatus;
    if (h === 'warning' || h === 'saturated') {
      setStreamingLastUnhealthyAt(Date.now());
    }
  }, [jobProgress, isRunning, displayPaused]);

  useEffect(() => {
    if (jobProgress?.healthStatus !== 'healthy' || streamingLastUnhealthyAt == null) {
      return undefined;
    }
    const elapsed = Date.now() - streamingLastUnhealthyAt;
    const wait = Math.max(0, STREAMING_WARNING_HOLD_MS - elapsed);
    const id = window.setTimeout(() => {
      setStreamingLastUnhealthyAt(null);
    }, wait);
    return () => clearTimeout(id);
  }, [jobProgress?.healthStatus, streamingLastUnhealthyAt]);

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

  // T1-42: previously `workFrame` used `computeGcodeOffset` directly,
  // which only handles the absolute / current / saved-origin offset
  // shift — it did NOT apply the front-origin Y-flip or the (now-
  // shipped, T1-40) right-origin X-flip. The displayed bounds and
  // the bed-bounds confirmation diverged from what `buildFrameCorners`
  // actually traces, so on front-origin machines (most consumer
  // diodes) the warning could say "inside bed" while the actual
  // frame motion went off-bed (or vice versa).
  //
  // Now `frameMachineBounds` derives directly from the same
  // `buildFrameCorners` that frame execution uses — single source of
  // truth for "where will the frame motion go." `confirmFrameBounds`
  // reads this for both the warning text and the off-bed block.
  const frameMachineBounds = useMemo(() => {
    const transformOpts = {
      startMode,
      savedOrigin,
      originCorner,
      bedHeightMm: bedHeight,
      bedWidthMm: bedWidth,
    };
    const corners = buildFrameCorners(sceneBounds, transformOpts);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    if (!Number.isFinite(minX)) {
      // Empty corners (degenerate scene) — fall back to zero so the
      // confirm path's checks don't trigger spurious warnings.
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    return { minX, minY, maxX, maxY };
  }, [
    startMode,
    savedOrigin,
    originCorner,
    bedHeight,
    bedWidth,
    sceneBounds.minX,
    sceneBounds.minY,
    sceneBounds.maxX,
    sceneBounds.maxY,
  ]);

  // T1-104 + T1-30: exact-idle gate via the centralized helper. Frame,
  // Frame Dot, and other Frame-derived surfaces all read from the same
  // gates map; previously each surface re-derived `isConnected &&
  // !isRunning && status === 'idle'` independently and missed gates
  // like laserOutputState !== 'off' (laser still on from prior op).
  const canFrame = gates?.canFrameSafe ?? false;

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
    // T1-50 Part A: rapid-double-click protection. The mutex covers
    // simulator connect too — same WebSerialPort/controller race
    // shape, just with a MockSerialPort instead.
    if (connecting) return;
    setConnecting(true);
    try {
      const mock = createSerialPort('simulator', { bedWidth, bedHeight }) as MockSerialPort;
      portRef.current = mock;
      mock.open();
      await ctrl.connect(mock);
      setSimulator(true);
      appendMessage('✓ Simulator connected');
    } catch (e: any) {
      appendMessage(`Connection failed: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const connectRealLaser = async () => {
    if (!WebSerialPort.isSupported()) {
      appendMessage('ERROR: Web Serial not supported in this browser');
      return;
    }
    // T1-50 Part A: see comment on the `connecting` state above.
    if (connecting) return;
    setConnecting(true);
    try {
      appendMessage('Port opened, waiting for GRBL welcome...');
      await machineService.connectRealLaser(activeProfile?.baudRate ?? 115200);
      setSimulator(false);
      appendMessage('✓ Real laser connected via USB');
    } catch (e: any) {
      appendMessage(`Connection failed: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = useCallback(async () => {
    const ctrl = controllerRef.current;
    jobStoppedByUserRef.current = true;
    intentionalDisconnectRef.current = true;
    try {
      if (ctrl?.isJobRunning) {
        try {
          ctrl.stop();
        } catch {
          /* ignore */
        }
      }

      stopTestFire();

      try {
        await machineService.disconnect();
      } catch {
        /* ignore */
      }
    } catch {
      /* best effort — still reset local state and close panel */
    }

    portRef.current = null;
    setShowSimulator(false);
    clearMessages();
    onDisconnect?.();
  }, [stopTestFire, onDisconnect, machineService, clearMessages, portRef]);

  // ─── Machine control ────────────────────────────────────

  const sendCmd = useCallback(
    async (cmd: string) => {
      if (!cmd.trim()) return;
      const classification = machineService.classifyUserCommand(cmd);
      // T1-19: confirm with the user, then mint a single-use approval
      // token via the service. The service is the issuer (UI can't
      // fabricate a valid token), command-binds the token, time-limits
      // it (~30s), and consumes the nonce on send. Replaces T1-6's
      // simpler `acknowledged` severity flag with single-use guarantees.
      let approvalToken: ApprovalToken | undefined;
      if (classification.severity === 'dangerous') {
        const ok = await showConfirm(
          'Dangerous command',
          `${classification.reason}\n\nSend "${classification.command}" anyway?`,
        );
        if (!ok) {
          appendMessage(`Blocked: ${classification.command}`);
          return;
        }
        approvalToken = machineService.requestApproval(cmd) ?? undefined;
      } else if (classification.severity === 'warn') {
        const ok = await showConfirm(
          'Machine state change',
          `${classification.reason}\n\nSend "${classification.command}"?`,
        );
        if (!ok) {
          appendMessage(`Cancelled: ${classification.command}`);
          return;
        }
        approvalToken = machineService.requestApproval(cmd) ?? undefined;
      }
      notifySimulatorTx(cmd);
      try {
        await machineService.sendCommand(cmd, 'user', approvalToken);
      } catch (err: unknown) {
        console.warn('[Command blocked]', err instanceof Error ? err.message : err);
        appendMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [appendMessage, machineService, notifySimulatorTx, showConfirm],
  );

  const handleJog = useCallback(
    (axis: 'X' | 'Y', distance: number) => {
      // T1-104: Jog requires exact idle. T1-105: hasJogged flips only
      // after the command is accepted by the transport.
      if (machineState?.status !== 'idle') {
        setMessages(prev => [...prev,
          `⚠ Jog declined: machine is "${machineState?.status ?? 'unknown'}", must be idle`,
        ]);
        return;
      }
      const result = executionCoordinator.jog(axis, distance, 3000);
      if (!result.ok) {
        setMessages(prev => [...prev,
          `⚠ Jog failed: ${result.reason ?? 'unknown'}. Check connection and machine state.`,
        ]);
        return;
      }
      hasJogged.current = true;
      setWorkflowVersion(v => v + 1);
    },
    [executionCoordinator, machineState?.status, setMessages],
  );

  const handleStartJob = async () => {
    if (!controllerRef.current) return;
    if (!compiledJobTicket) {
      setMessages(prev => [...prev, 'No compiled job — compile gcode first.']);
      return;
    }

    setIsPaused(false);
    setJobCompleted(false);

    // T1-41: verify saved-origin G54 hasn't drifted since Set Origin.
    // The work coordinate system anchors saved-origin jobs to the
    // physical workpiece corner; if it's been zeroed (reconnect's
    // applyWcsNormalization, console G10/G92, custom-start templates,
    // firmware power loss), the burn would land in the wrong place.
    // We block before preflight so the user fixes the cause before
    // dealing with whatever else preflight has to say.
    if (startMode === 'savedOrigin') {
      const expectedG54 = machineService.getSavedOriginG54Snapshot();
      const currentG54 = await machineService.requestWorkOffsets();
      const verified = verifySavedOriginG54(expectedG54, currentG54);
      if (!verified.ok) {
        let title = 'Saved origin not verified';
        let body: string;
        if (verified.reason === 'no-snapshot') {
          body = 'Saved origin has no recorded G54 snapshot — Set Origin again on the workpiece, or switch to absolute / from-laser-head mode.';
        } else if (verified.reason === 'no-current-g54') {
          body = 'The controller did not respond to the work-offset query in time. Verify the connection is healthy and try again, or switch to absolute / from-laser-head mode.';
        } else if (verified.reason === 'drift' && verified.drift) {
          title = 'Saved origin no longer valid';
          body = describeSavedOriginDrift(verified.drift);
        } else {
          body = 'Saved origin could not be verified — switch start mode or re-set origin.';
        }
        setMessages(prev => [...prev, `⚠ ${title}: ${body}`]);
        await showAlert(title, body);
        return;
      }
    }

    const preflightResult = await confirmPreflightForJobStart(
      preflight,
      showAlert,
      showConfirm,
      compiledJobTicket,
    );
    if (!preflightResult.confirmed) return;

    stopTestFire();

    const ticket = preflightResult.ticket?.ticket ?? compiledJobTicket;
    const lines = ticket.gcodeLines;
    if (!lastGcodeCompileResult) {
      setMessages(prev => [
        ...prev,
        'Cannot start: no compile result. Run Compile first.',
      ]);
      await showAlert('Cannot start job', 'G-code compile result is missing. Compile before starting.');
      return;
    }
    if (lastGcodeCompileResult.ticket.ticketId !== ticket.ticketId) {
      setMessages(prev => [
        ...prev,
        'Cannot start: compile result does not match the selected job ticket. Recompile.',
      ]);
      await showAlert('Cannot start job', 'The compile output is out of date for this ticket. Recompile, then start.');
      return;
    }
    setMessages(prev => [
      ...prev,
      `Starting job: ${lines.length} commands (readiness: ${preflight?.score ?? '?'}%, ticket ${ticket.ticketId})`,
    ]);
    try {
      const canvasContext = {
        canvasMoves: lastGcodeCompileResult.canvasMoves,
        canvasPlanBounds: lastGcodeCompileResult.canvasPlanBounds,
        machineTransform: lastGcodeCompileResult.machineTransform,
      };
      await executionCoordinator.startValidatedJob({
        ticket,
        scene,
        machineState,
        notifySimulatorTx,
        canvasContext,
      });
      jobStoppedByUserRef.current = false;
      const t0 = Date.now();
      jobStartTimeRef.current = t0;
      setJobStartTime(t0);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
    } catch (e: unknown) {
      executionCoordinator.clearJobSession();
      jobStartTimeRef.current = null;
      setJobStartTime(null);
      setElapsedSeconds(0);
      elapsedSecondsRef.current = 0;
      const msg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, `Failed to start: ${msg}`]);
      await showAlert('Cannot start job', msg);
    }
  };

  const confirmFrameBounds = useCallback(async (): Promise<boolean> => {
    // T1-42: derive bounds from buildFrameCorners (via the
    // frameMachineBounds memo) so the bed-bounds check sees the same
    // post-transform machine-space corners that the frame motion
    // actually traces. Pre-T1-42, this read the un-flipped workFrame
    // and could disagree with reality on front-origin machines.
    const x1 = frameMachineBounds.minX;
    const y1 = frameMachineBounds.minY;
    const x2 = frameMachineBounds.maxX;
    const y2 = frameMachineBounds.maxY;

    // T1-42 + audit Finding 2D-09: hard-block off-bed motion. Frame
    // is the user's chance to verify burn area before committing —
    // the laser can hit a limit switch (mechanical damage) or, on
    // frame-dot mode, fire low-power outside the workpiece. The
    // previous code lumped this with size warnings under a single
    // confirm dialog. Off-bed motion is now its own modal alert and
    // returns false without offering "frame anyway."
    const offBedReasons: string[] = [];
    if (x1 < 0) offBedReasons.push(`min X = ${x1.toFixed(1)} (off the LEFT edge of the bed)`);
    if (y1 < 0) offBedReasons.push(`min Y = ${y1.toFixed(1)} (off the FRONT edge of the bed)`);
    if (x2 > bedWidth) offBedReasons.push(`max X = ${x2.toFixed(1)} > bed width ${bedWidth} (off the RIGHT edge)`);
    if (y2 > bedHeight) offBedReasons.push(`max Y = ${y2.toFixed(1)} > bed height ${bedHeight} (off the REAR edge)`);
    if (offBedReasons.length > 0) {
      await showAlert(
        'Frame would go off the bed',
        `Frame motion is blocked because the machine-space bounds extend past the physical bed:\n\n`
        + offBedReasons.map(r => `  • ${r}`).join('\n')
        + `\n\nMove the design so it fits inside the bed, or change the start mode (current/saved-origin offsets shift the design relative to the head).`,
      );
      return false;
    }

    // Coverage warning is a quality concern, not a safety failure —
    // keep as a confirm-and-proceed dialog.
    const warnings: string[] = [];
    if ((x2 - x1) > bedWidth * 0.9 || (y2 - y1) > bedHeight * 0.9) {
      warnings.push('Frame covers most of the bed — make sure the laser has room');
    }
    if (warnings.length > 0) {
      const ok = await showConfirm(
        'Frame',
        'Frame the boundary anyway?',
        warnings.join('\n'),
      );
      return ok;
    }
    return true;
  }, [frameMachineBounds, bedWidth, bedHeight, showAlert, showConfirm]);

  const handleFrameSafe = useCallback(async () => {
    if (!canFrame) return;

    if (!(await confirmFrameBounds())) return;

    const transformOpts = {
      startMode,
      savedOrigin,
      originCorner,
      bedHeightMm: bedHeight,
      // T1-40: required for front-right / rear-right configurations
      // so the transform can mirror X. Harmless for left-origin
      // configurations.
      bedWidthMm: bedWidth,
    };

    const corners = buildFrameCorners(sceneBounds, transformOpts);

    const ys = corners.map(c => c.y);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);

    // T1-98: estimate idle timeout from corner travel distance instead
    // of using a fixed 15s deadline that can expire mid-frame.
    const idleTimeoutMs = estimateFrameIdleTimeoutMs(corners);

    setMessages(prev => [...prev,
      `Framing (safe): machine X${corners[0]!.x.toFixed(0)}-${corners[1]!.x.toFixed(0)} Y${yLo.toFixed(0)}-${yHi.toFixed(0)}`,
    ]);

    const result = await executionCoordinator.frameSafe({ sceneBounds, transformOpts, idleTimeoutMs });

    if (!result.ok) {
      setFrameRecoveryTimeoutSec(Math.round(idleTimeoutMs / 1000));
      if (result.reason === 'idle-timeout') {
        setMessages(prev => [...prev,
          `⚠ Frame (Safe): machine did not reach idle within ${Math.round(idleTimeoutMs / 1000)}s — check machine state`,
        ]);
      } else if (result.reason === 'command-blocked') {
        // T1-103: a command threw partway through corner streaming. The
        // frame is incomplete, so hasFramed must not be set.
        const lineNum = (result.blockedAtLine ?? 0) + 1;
        setMessages(prev => [...prev,
          `⚠ Frame (Safe): command blocked at line ${lineNum} — ${result.blockedError ?? 'unknown reason'}. Frame incomplete; retry after resolving controller state.`,
        ]);
      } else if (result.reason === 'no-controller') {
        setMessages(prev => [...prev, '⚠ Frame (Safe): no controller connection']);
      }
      return;
    }

    hasFramed.current = true;
    setFrameRecoveryTimeoutSec(null);
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Safe) complete']);
  }, [canFrame, confirmFrameBounds, sceneBounds, startMode, savedOrigin, originCorner, bedHeight, executionCoordinator, setMessages]);

  const handleFrameDot = useCallback(async () => {
    if (!canFrame) return;

    if (!(await confirmFrameBounds())) return;

    const acknowledged = localStorage.getItem('laserforge_frame_dot_acknowledged_v2');
    if (!acknowledged) {
      const ok = confirm(
        '⚠ Frame + Mark Center enables the laser at low power to trace the outline and draw a small + at the geometric center.\n\n' +
        'The center mark fires inside the design footprint. On slow diode lasers, even low power can scorch wood.\n\n' +
        'Use only with eye protection and material that can handle a brief mark.\n\n' +
        'Continue?',
      );
      if (!ok) return;
      localStorage.setItem('laserforge_frame_dot_acknowledged_v2', 'true');
    }

    const transformOpts = {
      startMode,
      savedOrigin,
      originCorner,
      bedHeightMm: bedHeight,
      // T1-40: required for front-right / rear-right configurations
      // so the transform can mirror X. Harmless for left-origin
      // configurations.
      bedWidthMm: bedWidth,
    };

    const corners = buildFrameCorners(sceneBounds, transformOpts);

    const ys = corners.map(c => c.y);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);

    setMessages(prev => [...prev,
      `Framing (laser dot): machine X${corners[0]!.x.toFixed(0)}-${corners[1]!.x.toFixed(0)} Y${yLo.toFixed(0)}-${yHi.toFixed(0)}`,
    ]);

    const maxSpindle = activeProfile?.maxSpindle ?? 1000;

    const result = await executionCoordinator.frameDot({
      sceneBounds,
      transformOpts,
      maxSpindle,
    });

    if (!result.ok) {
      setFrameRecoveryTimeoutSec(15);
      if (result.reason === 'idle-timeout') {
        setMessages(prev => [...prev, '⚠ Frame (Laser Dot): machine did not reach idle in time — check machine state']);
      } else if (result.reason === 'command-blocked') {
        const lineNum = (result.blockedAtLine ?? 0) + 1;
        setMessages(prev => [...prev,
          `⚠ Frame (Laser Dot): command blocked at line ${lineNum} — ${result.blockedError ?? 'unknown reason'}. Retry after resolving controller state.`,
        ]);
      } else if (result.reason === 'no-controller') {
        setMessages(prev => [...prev, '⚠ Frame (Laser Dot): no controller connection']);
      }
      return;
    }

    hasFramed.current = true;
    setFrameRecoveryTimeoutSec(null);
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Laser Dot) complete']);
  }, [activeProfile, canFrame, confirmFrameBounds, sceneBounds, startMode, savedOrigin, originCorner, bedHeight, executionCoordinator, setMessages]);

  const handleHome = useCallback(async () => {
    const ok = await showConfirm('Homing', 'Homing moves to limit switches. Continue?');
    if (ok) await executionCoordinator.home();
  }, [showConfirm, executionCoordinator]);

  const handleAutoFocus = useCallback(async () => {
    if (!showAutoFocus || !canAutoFocus || isAutoFocusing) return;
    setIsAutoFocusing(true);
    setMessages(prev => [...prev, 'Focusing...']);
    try {
      const result = await executionCoordinator.autoFocus();
      if (result.ok) {
        setMessages(prev => [...prev, '✓ Focus complete']);
        return;
      }
      setMessages(prev => [...prev, `⚠ Focus failed: ${result.error}`]);
      await showAlert('Autofocus failed', result.error);
    } finally {
      setIsAutoFocusing(false);
    }
  }, [canAutoFocus, executionCoordinator, isAutoFocusing, setMessages, showAlert, showAutoFocus]);

  const handleUnlock = useCallback(async () => {
    const classification = machineService.classifyUserCommand(GRBL_USER_LINE_FOR_UNLOCK_CLASSIFY);
    const ok = await showConfirm(
      'Dangerous command',
      `${classification.reason}\n\nSend "${classification.command}" anyway?`,
    );
    if (!ok) {
      appendMessage(`Blocked: ${classification.command}`);
      return;
    }
    await executionCoordinator.unlock();
  }, [appendMessage, machineService, showConfirm, executionCoordinator]);

  const handleRecoveryAction = useCallback((action: RecoveryAction) => {
    switch (action) {
      case 'unlock':
        void handleUnlock();
        break;
      case 'home':
      case 're-home':
        void handleHome();
        break;
      case 'frame':
      case 'reframe':
        void handleFrameSafe();
        break;
      case 'reconnect':
        setConnectionRecoveryVisible(false);
        break;
      default:
        break;
    }
  }, [handleFrameSafe, handleHome, handleUnlock]);

  /**
   * T2-12 part 2: clear a 'faulted_requires_inspection' state after
   * the user has confirmed they've inspected the machine. Asks once
   * for explicit confirmation (the fault state exists precisely because
   * we don't trust the machine to be in a clean state, so a one-click
   * dismiss would defeat the gate's purpose).
   */
  const handleAcknowledgeFault = useCallback(async () => {
    const ok = await showConfirm(
      'Acknowledge fault',
      'A job stopped due to an error. Confirm you have inspected the machine and workpiece, and that it is safe to return to idle.',
    );
    if (!ok) return;
    const ctrl = controllerRef.current;
    if (!ctrl?.acknowledgeFault) {
      // Defensive — interface declares this method as optional. UI
      // should only render the button when status is faulted, which
      // implies a controller that produces the faulted state, which
      // implies acknowledgeFault is implemented. But guard anyway.
      appendMessage('Cannot acknowledge fault: controller does not support it.');
      return;
    }
    const result = await ctrl.acknowledgeFault();
    if (!result.ok) {
      appendMessage(`Acknowledge fault failed: ${result.reason ?? 'unknown reason'}`);
    } else {
      appendMessage('Fault acknowledged. Machine returned to idle.');
    }
  }, [appendMessage, controllerRef, showConfirm]);

  const handlePauseResume = useCallback(async () => {
    const held = isPaused || machineState?.status === 'hold';
    try {
      if (held) {
        machineService.resume();
      } else {
        machineService.pause();
      }
      setIsPaused(!held);
    } catch (err: unknown) {
      // T1-64: previously this catch logged to console only. For
      // safety-critical machine controls the user MUST know if their
      // pause/resume request didn't reach the machine — silent failure
      // could leave the user thinking the laser was paused when the
      // job is still running. Surface to the messages console for the
      // mild case (resume failed → user can retry) and a modal for
      // the dangerous case (pause failed → job may still be running).
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Pause/Resume]', msg);
      appendMessage(`⚠ ${held ? 'Resume' : 'Pause'} command not accepted: ${msg}`);
      if (!held) {
        void showAlert(
          'Pause failed',
          `The pause command was not accepted by the machine. The job may still be running.\n\n`
          + `Use Stop to halt the job, or use the machine's physical pause/stop control.`,
        );
      }
    }
  }, [appendMessage, isPaused, machineState?.status, machineService, showAlert]);

  const handleStop = useCallback(async () => {
    jobStoppedByUserRef.current = true;
    try {
      await machineService.stopAndEnsureLaserOff(notifySimulatorTx);
      // Do NOT auto-send $X — leave machine in alarm/lock state
      // so operator can inspect before unlocking manually
      setIsPaused(false);
    } catch (err: unknown) {
      // T1-64: stop is the most safety-critical control. A silent stop
      // failure means the user clicked Stop, the job potentially keeps
      // running, and the UI gives no indication anything went wrong.
      // Surface as both a console message AND a modal alert so the
      // user is forced to acknowledge before doing anything else.
      // The job's still-running state means we cannot quietly clear
      // isPaused — leave it alone so the UI's pause indication
      // reflects the last known machine state.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[Stop]', msg);
      appendMessage(`⚠ Stop command not accepted: ${msg}. The job may still be running.`);
      void showAlert(
        'Stop failed',
        `The stop command was not accepted by the machine. The job may still be running.\n\n`
        + `Take immediate action: use the machine's physical E-stop / power switch, or disconnect to terminate communication.\n\n`
        + `Error: ${msg}`,
      );
    }
  }, [appendMessage, notifySimulatorTx, machineService, showAlert]);

  /** Deadman: laser is on only while primary pointer is held on the button. */
  const beginTestFire = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const ctrl = controllerRef.current;
      if (!ctrl || isTestFiringRef.current) return;
      // T1-104: positive idle check replaces ad-hoc per-state denials.
      if (machineState?.status !== 'idle') return;

      const acknowledged = localStorage.getItem('laserforge_testfire_acknowledged');
      if (!acknowledged) {
        const ok = confirm(
          '⚠ Test Fire enables the laser at low power (5% of your machine\'s max spindle / S range).\n\n' +
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

      const maxSpindle = activeProfile?.maxSpindle ?? 1000;

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      void executionCoordinator.beginTestFire({ maxSpindle }).then(ok => {
        if (!ok) {
          try {
            e.currentTarget.releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          return;
        }
        testFirePointerCaptureRef.current = { pointerId: e.pointerId, el: e.currentTarget };
        setIsTestFiring(true);
        // T1-18: ExecutionCoordinator.beginTestFire arms its own deadman timer.
        // UI no longer schedules an auto-stop — pointer-up / pointer-cancel /
        // unmount paths still call stopTestFire for responsive UX, but they are
        // no longer the safety guarantee.
      });
    },
    [activeProfile, machineState?.status, executionCoordinator],
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
    void elapsedSeconds; // tick once per second while the job is active
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
  const machineStatus = machineState?.status;
  const machineBlocksJobStart =
    isConnected &&
    !isSimulator &&
    machineStatus != null &&
    machineStatus !== 'idle' &&
    machineStatus !== 'disconnected' &&
    machineStatus !== 'connecting';
  // T1-59 frame-before-start gate. When T2-64 (advanced-mode setting) lands,
  // this becomes `const requireFrame = !advancedMode`. Until then, beginner
  // default = require frame. Prevents wrong-position-burn on confused
  // origin/saved-origin/mirror configurations.
  const requireFrame = true;
  // T1-22: read laser-output safety state for the start-job gate.
  // T2-12 part 1: subscribed instead of polled. The previous polled
  // getter at this site relied on workflowVersion bumps to refresh on
  // every transition; subscription is more direct and removes the need
  // to keep this read inside the workflowVersion-touch envelope.
  // Initial value via lazy useState so the very first render reflects
  // current state (e.g. after a remount). Effect re-syncs on mount in
  // case the value changed between render and effect-run, then
  // subscribes for subsequent changes.
  const [laserOutputState, setLaserOutputStateLocal] = useState<LaserOutputState>(
    () => machineService.getLaserOutputState(),
  );
  useEffect(() => {
    setLaserOutputStateLocal(machineService.getLaserOutputState());
    return machineService.onLaserOutputStateChange(setLaserOutputStateLocal);
  }, [machineService]);
  // T1-20: read placement-uncertain state for the start-job gate. Set
  // by GrblController._emitWcsPayload when the WCS consent flow has no
  // listeners and the controller wasn't constructed with the headless
  // flag. Polled per-render — placement-uncertain transitions fire a
  // state-change event so the UI re-renders and re-evaluates this gate.
  // Optional method on the interface; default false (not uncertain) for
  // controllers that don't implement it.
  const placementUncertain =
    controllerRef.current?.getPlacementUncertain?.() ?? false;
  // T1-30: canStartJob keeps its existing product-level conjuncts
  // (gcode exists / fresh / framed / preflight passed / not running /
  // machine bounds OK / laser output not unknown / WCS not uncertain)
  // and adds `gates.baseSafe` as a defense-in-depth conjunct. baseSafe
  // collapses status === 'idle', laserOutput === 'off', no active
  // operation, no error code, and no pending recovery into one check;
  // each of those was already implied by some upstream gate
  // (preflight covers status; laser-output covers itself via
  // laserOutputState !== 'unknown'; machineBlocksJobStart covers
  // errorCode/alarm), but consolidating here makes the safety story
  // legible and prevents drift if any upstream gate weakens.
  const canStartJob =
    !!gcode &&
    !isRunning &&
    !!preflight?.canStart &&
    !gcodeStale &&
    !machineBlocksJobStart &&
    (!requireFrame || hasFramed.current) &&
    laserOutputState !== 'unknown' &&
    !placementUncertain &&
    (gates?.baseSafe ?? false);
  /**
   * T1-96: structured Start-button readiness for the diagnostics panel.
   *
   * Each gate corresponds 1:1 with a conjunct in `canStartJob` above.
   * `blockingGate` is the first failing gate; it drives the collapsed
   * headline. When `canStartJob` is true, `ready` is true and the panel
   * renders nothing.
   */
  const startReadiness: StartReadiness = (() => {
    const blockerCount = preflight?.blockers ?? 0;
    const warningCount = preflight?.warnings ?? 0;
    const preflightDetails = (preflight?.issues ?? [])
      .filter(i => i.severity === 'blocker' || i.severity === 'warning')
      .slice(0, 5)
      .map(i => ({
        severity: i.severity as 'blocker' | 'warning',
        text: i.title,
      }));

    const gates: StartReadinessGate[] = [
      {
        id: 'controllerConnected',
        label: 'Controller connected',
        status: isConnected ? 'ok' : 'fail',
        failHeadline: 'No controller connection',
        failAction: 'Connect to the laser using the Connect button above',
      },
      {
        id: 'gcodeCompiled',
        label: 'G-code compiled',
        status: gcode ? 'ok' : 'fail',
        failHeadline: 'No G-code yet',
        failAction: 'Click G-code in the toolbar to compile this design',
      },
      {
        id: 'gcodeFresh',
        label: 'G-code matches current design',
        status: !gcode ? 'pending' : (gcodeStale ? 'fail' : 'ok'),
        failHeadline: 'Design changed since last compile',
        failAction: 'Click ↻ Update above to recompile',
      },
      {
        id: 'preflight',
        label: 'Design preflight checks',
        status: preflight == null
          ? 'pending'
          : (preflight.canStart ? 'ok' : 'fail'),
        failHeadline: blockerCount > 0
          ? `${blockerCount} blocker${blockerCount === 1 ? '' : 's'}${warningCount > 0 ? ` and ${warningCount} warning${warningCount === 1 ? '' : 's'}` : ''}`
          : 'Preflight blocked',
        failDetails: preflightDetails,
        failAction: 'Open the Issues panel above to see and fix each one',
      },
      {
        id: 'machineState',
        label: 'Machine idle',
        status: !isConnected || isSimulator
          ? 'pending'
          : (machineBlocksJobStart ? 'fail' : 'ok'),
        failHeadline: machineStatus
          ? `Machine is "${machineStatus}"`
          : 'Machine not in idle state',
        failAction: 'Wait for idle, or stop/reset on the controller if it is stuck',
      },
      {
        id: 'framing',
        label: 'Job framed',
        status: !requireFrame
          ? 'ok'
          : (hasFramed.current ? 'ok' : 'fail'),
        failHeadline: 'Frame not done since last design change',
        failAction: 'Click Frame to confirm where the laser will burn (resets when you edit the design)',
      },
      {
        id: 'laserState',
        label: 'Laser-safety state known',
        status: laserOutputState === 'unknown' ? 'fail' : 'ok',
        failHeadline: 'Laser-safety state unknown',
        failAction: 'A previous laser-off write failed — disconnect and reconnect to clear',
      },
      {
        id: 'wcsState',
        label: 'Work-coordinate state confirmed',
        status: placementUncertain ? 'fail' : 'ok',
        failHeadline: 'Work-coordinate state could not be confirmed',
        failAction: 'No WCS consent prompt was shown on connect — disconnect and reconnect to retry',
      },
    ];

    if (isRunning) {
      return { ready: true, blockingGate: null, gates };
    }

    const blockingGate = gates.find(g => g.status === 'fail') ?? null;
    return {
      ready: canStartJob,
      blockingGate,
      gates,
    };
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

  const alarmRecoveryContent = isConnected && machineState?.status === 'alarm'
    ? buildRecoveryCard({ variant: 'alarm', alarmCode: machineState?.alarmCode ?? null })
    : null;
  const alarmBanner = alarmRecoveryContent && React.createElement(RecoveryCard, {
    content: alarmRecoveryContent,
    onAction: handleRecoveryAction,
  });
  const faultedBanner = isConnected && machineState?.status === 'faulted_requires_inspection' && React.createElement('div', {
    // T2-12 part 2: distinct from alarmBanner because the recovery
    // affordance differs. Alarm = "clear with $X" (firmware alarm
    // condition). Faulted = "we stopped your job mid-cut due to an
    // error and need you to look at the machine before retrying."
    // Same visual structure as alarmBanner so users don't have to
    // learn two layouts; only the copy and button differ.
    style: {
      margin: '10px 16px 0',
      padding: '12px 14px',
      background: 'rgba(255,68,102,0.08)',
      border: '1px solid rgba(255,68,102,0.4)',
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      flexShrink: 0,
    },
  },
    React.createElement('div', { style: { fontSize: 20, flexShrink: 0 } }, '⚠'),
    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
      React.createElement('div', {
        style: { fontSize: 12, fontWeight: 600, color: '#ff4466', marginBottom: 2 },
      }, 'Machine fault — job stopped'),
      React.createElement('div', {
        style: { fontSize: 10, color: '#ff8ca0', lineHeight: 1.4 },
      }, machineState?.errorCode != null
        ? `Error ${machineState.errorCode}. Inspect the workpiece and machine, then acknowledge to return to idle.`
        : 'Inspect the workpiece and machine, then acknowledge to return to idle.'),
    ),
    React.createElement('button', {
      type: 'button',
      onClick: () => { void handleAcknowledgeFault(); },
      style: {
        padding: '8px 18px',
        fontSize: 12,
        fontWeight: 700,
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: font,
        background: '#ff4466',
        border: '1px solid #ff4466',
        color: '#fff',
        flexShrink: 0,
        whiteSpace: 'nowrap' as const,
      },
    }, '⚠ Acknowledge fault'),
  );

  const isOperational = isConnected && machineState?.status !== 'connecting';
  const appendBannerMessage = useCallback(
    (msg: string) => setMessages(prev => [...prev, msg]),
    [setMessages],
  );
  const laserModeBanner = React.createElement(LaserModeBanner, {
    controller: controllerRef.current,
    isOperational,
    showConfirm,
    sendUserCommand: sendCmd,
    appendMessage: appendBannerMessage,
  });

  const connectSection = React.createElement(ConnectWizard, {
    webSerialSupported: WebSerialPort.isSupported(),
    onConnectUsb: () => { void connectRealLaser(); },
    onConnectSimulator: () => { void connectSimulator(); },
    connecting,
  });

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
  const estimatedTimeFormatted = gcode ? estimateJobTime(gcode).formatted : null;

  const workflowSection = isConnected && React.createElement(React.Fragment, null,
    React.createElement(Workflow, {
      startMode,
      onSelectMode,
      startPositionStatus,
      machinePositionKnown: !!machinePosition,
      hasJogged: hasJogged.current,
      hasSetOrigin: hasSetOrigin.current,
      hasFramed: hasFramed.current,
      canStartJob,
      startJobDesc,
      estimatedTimeFormatted,
      isConnected,
      onSaveOrigin: () => {
        hasSetOrigin.current = true;
        setWorkflowVersion(v => v + 1);
        onSaveOrigin();
      },
    }),
  );

  const controlsSection = isConnected && React.createElement('div', {
    style: { padding: '12px 16px', borderBottom: '1px solid #1a1a2e', display: 'flex', gap: 16, flexShrink: 0 },
  },
    React.createElement(Jog, {
      jogStep,
      setJogStep,
      onJog: handleJog,
      onHome: () => { void handleHome(); },
      showFocus: showAutoFocus,
      canFocus: canAutoFocus,
      focusBusy: isAutoFocusing,
      onFocus: () => { void handleAutoFocus(); },
    }),
    isAutoFocusing && React.createElement('div', {
      style: { fontSize: 10, color: '#00d4ff', alignSelf: 'center' },
    }, 'Focusing...'),
    React.createElement(MachineControls, {
      isAlarm: machineState?.status === 'alarm',
      // T2-12 part 2: faulted is its own halt-state with its own
      // recovery affordance (Acknowledge fault, not Unlock).
      isFaulted: machineState?.status === 'faulted_requires_inspection',
      isRunning,
      canFrame,
      // T1-30: test-fire gate now reads from the centralized helper
      // (canTestFire). Pre-T1-30 it aliased canFrame; pre-T1-104 it
      // didn't even gate on idle state. Identical to canFrameSafe today
      // but kept as a separate gate so per-operation refinements don't
      // touch the MachineControls prop shape.
      canFire: gates?.canTestFire ?? false,
      isTestFiring,
      onUnlock: handleUnlock,
      onAcknowledgeFault: () => { void handleAcknowledgeFault(); },
      onTestFireBegin: beginTestFire,
      onTestFireEnd: endTestFire,
      onFrameDot: () => { void handleFrameDot(); },
    }),
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
            { mode: 'offset' as const, label: 'Offset (coming soon)' },
            { mode: 'cross-hatch' as const, label: 'Cross-hatch' },
          ]).map(f =>
            React.createElement('button', {
              type: 'button',
              key: f.mode,
              disabled: f.mode === 'offset',
              onClick: () => {
                if (f.mode === 'offset') return;
                onUpdateLayerFillMode(layer.id, f.mode);
              },
              title: f.mode === 'offset' ? 'Offset fill not yet implemented' : undefined,
              style: {
                flex: 1, padding: '3px', fontSize: 9, borderRadius: 3,
                cursor: f.mode === 'offset' ? 'not-allowed' : 'pointer',
                opacity: f.mode === 'offset' ? 0.5 : 1,
                fontFamily: font,
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

  const connectionRecoveryContent = connectionRecoveryVisible
    ? buildRecoveryCard({ variant: 'disconnect' })
    : null;
  const connectionRecoveryCard = connectionRecoveryContent &&
    React.createElement(RecoveryCard, {
      content: connectionRecoveryContent,
      onAction: handleRecoveryAction,
    });

  const frameRecoveryContent = frameRecoveryTimeoutSec != null
    ? buildRecoveryCard({ variant: 'frame-failed', frameTimeoutSec: frameRecoveryTimeoutSec })
    : null;
  const frameRecoveryCard = frameRecoveryContent &&
    React.createElement(RecoveryCard, {
      content: frameRecoveryContent,
      onAction: handleRecoveryAction,
    });

  const safetyRecoveryContent = safetyState.kind === 'requiresInspection'
    ? buildRecoveryCard({ variant: 'emergency-stop' })
    : null;
  const safetyRecoveryCard = safetyRecoveryContent &&
    React.createElement(RecoveryCard, {
      content: safetyRecoveryContent,
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

  const showStreamingHealthBanner = Boolean(
    jobProgress &&
    (isRunning || displayPaused) &&
    (jobProgress.healthStatus !== 'healthy' || streamingLastUnhealthyAt !== null),
  );

  const streamingHealthBanner =
    jobProgress &&
    showStreamingHealthBanner &&
    React.createElement('div', {
      style: {
        padding: '8px 12px',
        margin: '0 16px 8px',
        background: jobProgress.healthStatus === 'saturated'
          ? 'rgba(255, 68, 102, 0.12)'
          : 'rgba(255, 170, 80, 0.12)',
        border: jobProgress.healthStatus === 'saturated'
          ? '1px solid rgba(255, 68, 102, 0.4)'
          : '1px solid rgba(255, 170, 80, 0.4)',
        borderRadius: 6,
        fontSize: 11,
        color: jobProgress.healthStatus === 'saturated' ? '#ff4466' : '#ffaa50',
        lineHeight: 1.4,
        flexShrink: 0,
      },
    },
      React.createElement('div', { style: { fontWeight: 600, marginBottom: 2 } },
        jobProgress.healthStatus === 'saturated'
          ? '⚠ Connection saturated'
          : 'Connection under pressure',
      ),
      React.createElement('div', { style: { color: '#8888aa', fontSize: 10 } },
        jobProgress.healthStatus === 'saturated'
          ? 'Your connection cannot keep up with the job speed. The laser may stall. Try: reduce scan speed, or switch from WiFi to USB.'
          : 'Streaming is slower than expected. The job should continue, but consider reducing scan speed if this worsens.',
      ),
    );

  const jobProgressSection = isConnected && (isRunning || displayPaused) && React.createElement(
    React.Fragment,
    null,
    streamingHealthBanner,
    React.createElement(Progress, {
      jobProgress,
      displayPaused,
      elapsedSeconds,
      estimatedRemaining,
      activeLabel: jobModeLabel(scene),
      planSummary: jobModePlanSummary(scene),
    }),
  );

  const footerSection = isConnected && React.createElement(Controls, {
    canFrame,
    canStartJob,
    isSimulator,
    isRunning,
    displayPaused,
    startReadiness,
    onFrame: () => { void handleFrameSafe(); },
    onStartJob: () => { void handleStartJob(); },
    onPauseResume: () => { void handlePauseResume(); },
    onStop: () => { void handleStop(); },
  });

  // T1-60: device profile selector pinned to the panel — always visible
  // when connected, never buried under "More options." The active profile
  // governs the most safety-critical settings (bed dimensions, origin
  // corner, max spindle, homing, header/footer templates); a wrong
  // profile makes every other setting wrong. Audit 4B Critical UX
  // failure 3 framed the pre-T1-60 location ("More options" collapse) as
  // a top-tier "wrong place to burn" cause for beginners. The selector
  // is now always rendered just above the workflow body.
  const profileSection = isConnected && React.createElement('div', {
    style: {
      padding: '8px 16px',
      borderTop: '1px solid #1a1a2e',
      flexShrink: 0,
      background: 'rgba(0, 212, 255, 0.02)',
    },
  },
    React.createElement(DeviceProfileSelector, {
      scene,
      onSceneCommit,
      onMessage: (msg: string) => setMessages(prev => [...prev, msg]),
      onOpenSettings,
    }),
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
              React.createElement('div', {
                key: i,
                style: {
                  color: msg.startsWith('[sys]')
                    ? '#3a3a55'
                    : msg.startsWith('ERROR') || msg.startsWith('⚠')
                      ? '#ff4466'
                      : msg.startsWith('>')
                        ? '#00d4ff'
                        : msg.startsWith('✓')
                          ? '#2dd4a0'
                          : '#555570',
                  fontStyle: msg.startsWith('[sys]') ? 'italic' : 'normal',
                },
              }, msg),
            ),
      ),
      !productionMode && messages.length > 0 && React.createElement('div', {
        style: { fontSize: 10, color: '#555570', lineHeight: 1.4 },
      }, React.createElement('span', {
        style: {
          color: messages[messages.length - 1].startsWith('[sys]')
            ? '#3a3a55'
            : messages[messages.length - 1].startsWith('✓')
              ? '#2dd4a0'
              : messages[messages.length - 1].startsWith('ERROR')
                ? '#ff4466'
                : '#8888aa',
          fontStyle: messages[messages.length - 1].startsWith('[sys]') ? 'italic' : 'normal',
        },
      }, messages[messages.length - 1])),
      productionMode && jobProgress && React.createElement('div', {
        style: {
          fontSize: 10,
          color: '#555570',
          fontFamily: mono,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        },
      },
        React.createElement('span', {
          style: {
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            background:
              jobProgress.healthStatus === 'saturated'
                ? '#ff4466'
                : jobProgress.healthStatus === 'warning'
                  ? '#ffaa50'
                  : '#2dd4a0',
          },
          title:
            jobProgress.healthStatus === 'saturated'
              ? 'Streaming saturated — laser may stall'
              : jobProgress.healthStatus === 'warning'
                ? 'Streaming under pressure'
                : 'Streaming healthy',
        }),
        `Buffer ${jobProgress.bufferFill ?? 0}/127`,
        jobProgress.ackRateHz != null &&
          React.createElement('span', { style: { color: '#444460' } },
            ` · ${jobProgress.ackRateHz.toFixed(0)} acks/s`),
      ),
      productionMode && React.createElement('div', { style: { display: 'flex', gap: 6 } },
        React.createElement('input', {
          type: 'text', value: manualCmd, placeholder: 'G-code…',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setManualCmd(e.target.value),
          onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') { void sendCmd(manualCmd); setManualCmd(''); } },
          style: { flex: 1, padding: '6px 8px', background: '#0a0a14', border: '1px solid #252540', borderRadius: 6, color: '#e0e0ec', fontSize: 10, fontFamily: mono, outline: 'none' },
        }),
        React.createElement('button', { type: 'button', onClick: () => { void sendCmd(manualCmd); setManualCmd(''); }, style: btnStyle('0,212,255') }, 'Send'),
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
      originCorner,
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
        alarmBanner,
        faultedBanner,
        laserModeBanner,
        connectSection,
      }),
      connectionRecoveryCard,
      frameRecoveryCard,
      safetyRecoveryCard,
      isConnected && !isRunning && !displayPaused && controlsSection,
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
        profileSection,
        React.createElement(MoveControls, {
          isConnected,
          isRunning,
          displayPaused,
          workflowSection,
          layerOverviewSection,
          gcodeWarning,
          issuesSection,
          outcomeExtrasSection,
        }),
        React.createElement(ConsolePanel, {
          isConnected,
          isRunning,
          controller: controllerRef.current,
          sendUserCommand: sendCmd,
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
            const result = machineService.emergencyStop();
            void showAlert(
              result.accepted ? 'Emergency stop' : 'Emergency stop failed',
              result.message
                ?? (result.accepted
                  ? 'The machine was reset and the connection was closed. Reconnect when it is safe to continue.'
                  : 'The controller did not accept the emergency stop. Use the physical E-stop or power disconnect, then inspect the machine before reconnecting.'),
            );
            portRef.current = null;
            setIsPaused(false);
            setMessages(prev => [
              ...prev,
              result.accepted
                ? '⚠ EMERGENCY STOP — disconnected. Reconnect when safe.'
                : `⚠ EMERGENCY STOP FAILED — ${result.message ?? 'use physical E-stop or power disconnect immediately.'}`,
            ]);
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
