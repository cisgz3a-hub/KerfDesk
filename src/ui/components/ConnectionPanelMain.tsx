import React, { useState, useEffect, useRef, useCallback, useMemo, type MutableRefObject } from 'react';
import { type LaserController } from '../../controllers/ControllerInterface';
import { type WcsUncertainReason } from '../../controllers/grbl/GrblWcsConsentClassifier';
import { MockSerialPort, type SerialPortLike } from '../../communication/SerialPort';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { createSerialPort } from '../../communication/SerialPortFactory';
import { type MachineState, type JobProgress } from '../../controllers/ControllerInterface';
import { estimateJobTime } from '../../core/output/TimeEstimator';
import { type Scene } from '../../core/scene/Scene';
import { type LayerMode } from '../../core/scene/Layer';
import { DeviceProfileSelector } from './DeviceProfileSelector';
import { JobLogViewer } from './JobLogViewer';
import { runPreflightSummary, type PreflightSummary } from '../../core/preflight/Preflight';
import {
  confirmPreflightForJobStart,
} from '../../core/preflight/confirmPreflightForJobStart';
import type { ValidatedJobTicket } from '../../core/job/ValidatedJobTicket';
import {
  resolveFrameDotFeedRate,
  resolveFrameLineDelayMs,
  saveDeviceProfile,
  type DeviceProfile,
  type MachineOriginCorner,
} from '../../core/devices/DeviceProfile';
import { GRBL_USER_LINE_FOR_UNLOCK_CLASSIFY } from '../../core/grbl/grblClassifierLines';
import { type MachineService, type LaserOutputState } from '../../app/MachineService';
import { recoveryAllowsStart } from '../../runtime/RecoveryState';
import { type StructuredLogEvent, type StructuredLogEventInput } from '../../app/StructuredMessageLog';
import { buildJobComplexitySummary } from '../../app/JobComplexitySummary';
// T1-143: describeFrameFailure usage moved into connectionPanelLabels.
import { type ApprovalToken } from '../../app/MachineCommandGateway';
import { computeCommandGates } from '../../app/computeCommandGates';
import { getUnsafePriorState } from '../../app/unsafePriorState';
import { computeFrameFreshnessKey } from '../../app/computeFrameFreshnessKey';
import { ExecutionCoordinator, type FrameResult } from '../../app/ExecutionCoordinator';
import { type CompileGcodeResult, type CompileProgress } from '../../app/PipelineService';
import { buildFrameCorners } from '../../app/frameGcode';
import {
  createFramedStartTicket,
  createUnframedStartOverrideTicket,
  validateFrameTicketForStart,
  type FrameTicket,
} from '../../app/FrameState';
import {
  verifySavedOriginG54,
  describeSavedOriginDrift,
} from '../../app/savedOriginVerify';
import {
  captureCurrentFrameAnchor,
  currentModeFrameAnchorAllowsStart,
  type CurrentFrameAnchor,
} from '../../app/CurrentFrameAnchor';
import {
  buildGoToLastPositionJogs,
  captureLastJobStartPosition,
  describeLastMachinePosition,
  type LastMachinePosition,
} from '../../app/LastMachinePosition';
import { estimateFrameIdleTimeoutMs } from '../../app/grblIdlePoll';
import { computeGcodeOffset, type GcodeStartMode } from '../../core/output/GcodeOrigin';
import { physicalBoundsFromWorkBounds } from '../../core/plan/MachineBounds';
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
import type { StartReadiness } from './connection/StartReadinessPanel';
import { buildStartReadiness } from './connection/buildStartReadiness';
// T1-143: pure label/format/scene-summary helpers moved out so they
// can be tested without mounting the panel.
import {
  buildReadyOperationRows,
  formatJobTime,
  frameFailureLogLine,
  jobModeLabel,
  layerModeToOperationKind,
  readyStartModeLabel,
} from './connection/connectionPanelLabels';
// T1-144: structural-equality comparators used by setMessages /
// setPreflight effects to skip redundant state updates.
import {
  samePreflightSummary,
  sameMessages,
} from './connection/connectionPanelEquality';
// T1-157: completion beep (WebAudio side-effect) moved to its own
// module so the panel's render body skips the audio detail.
import { playCompletionBeep } from './connection/playCompletionBeep';
import { ReadyToRunPanel, type ReadyToRunPanelData, type ReadyToRunWarning } from './connection/ReadyToRunPanel';
import { JobPosition, WorkflowSteps } from './connection/Workflow';
import {
  ConnectionDetailsPanel,
  JobDetailsLaunchers,
  type ConnectionDetailsPanelKey,
} from './connection/ConnectionDetailsPanel';
import { MachineControls } from './connection/MachineControls';
import { UnsafeAtConnectBanner } from './connection/UnsafeAtConnectBanner';
import { type UnsafeAtConnectActionKind } from './connection/unsafeAtConnectMessages';
import { type SettingsTab } from './SettingsModal';
import { type SafetyState } from '../../app/SafetyStateMachine';
import { analyzeOperationOrder } from '../../app/OperationOrder';
import { computeUserModeGatePolicy, type UserMode } from '../../app/UserModeGates';
import { RecoveryCard } from '../recovery/RecoveryCard';
import { buildRecoveryCard, type RecoveryAction } from '../recovery/RecoveryCardContent';

// T1-143: jobModeLabel moved to ./connection/connectionPanelLabels.

type StartMode = GcodeStartMode;

/** Keep streaming-health banner visible briefly after status recovers (reduces flicker). */
const STREAMING_WARNING_HOLD_MS = 3000;
const CURRENT_MODE_LONG_JOB_TIP_KEY = 'laserforge_current_mode_long_job_tip_acknowledged';
const ACTIVE_PROFILE_CHANGED_EVENT = 'laserforge:active-profile-changed';

// T1-143: formatJobTime / readyStartModeLabel / layerModeToOperationKind
// / buildReadyOperationRows / frameFailureLogLine all moved to
// ./connection/connectionPanelLabels.

// T1-157: playCompletionBeep moved to ./connection/playCompletionBeep.

// T1-144: samePreflightSummary + sameMessages moved to
// ./connection/connectionPanelEquality.

export interface ConnectionPanelMainProps {
  controller: LaserController;
  portRef: React.MutableRefObject<SerialPortLike | null>;
  machineState: MachineState | null;
  jobProgress: JobProgress | null;
  scene: Scene;
  gcode: string | null;
  bedWidth: number;
  bedHeight: number;
  /**
   * T1-218 (v30 audit #1): false when bedWidth/bedHeight came from
   * the 300mm DEFAULT_MACHINE_BED_MM fallback rather than a real
   * source (controller `$130/$131` or explicit profile setting).
   * Threaded through to preflight so MISSING_BED_SIZE blocks job
   * start instead of accepting a phantom bed. Defaults to `true`
   * for backwards-compatibility with test callers; production
   * (App.tsx) always supplies the real flag from
   * `bedDimensionsKnown(profile, machineBedFromGrbl)`.
   */
  bedDimensionsKnown?: boolean;
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
  frameTransformBoundsMinX?: number;
  frameTransformBoundsMinY?: number;
  frameTransformBoundsMaxX?: number;
  frameTransformBoundsMaxY?: number;
  onClose: () => void;
  /**
   * Active device profile (memoized in App; re-reads when profileRevision increments).
   * Null if no profile is selected.
   */
  activeProfile: DeviceProfile | null;
  /** Called after a successful disconnect cleanup so the host can hide the panel */
  onDisconnect?: () => void;
  productionMode?: boolean;
  userMode?: UserMode;
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
  isCompiling?: boolean;
  compileProgress?: CompileProgress | null;
  isCompileCancelling?: boolean;
  onCancelCompile?: () => void;
  /**
   * T1-75: increments when App.tsx applies an undo/redo. The panel watches
   * this counter via an effect that resets `hasFramed` (the burn bounds may
   * have changed, so the previous frame action no longer reflects the
   * current scene). Initial value 0 from App.tsx.
   */
  historyVersion?: number;
  onRecompile?: () => void | boolean | Promise<boolean>;
  onOpenSettings?: (tab?: SettingsTab) => void;
  /** Panel width in px (host computes min(500, 45% window)). */
  sidebarWidth?: number;
  machineService: MachineService;
  /** Shared with App (save origin, etc.); simulator notify ref is wired in an effect. */
  executionCoordinator: ExecutionCoordinator;
  coordinatorSimulatorNotifyRef: MutableRefObject<(line: string) => void>;
  outcomeReplaySection: React.ReactNode;
  messages: string[];
  messageEvents?: StructuredLogEvent[];
  appendMessage: (message: string) => void;
  appendLogEvent?: (event: StructuredLogEventInput) => void;
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
  bedDimensionsKnown = true,
  machinePlanBounds = null,
  compiledJobTicket = null,
  lastGcodeCompileResult = null,
  boundsMinX,
  boundsMinY,
  boundsMaxX,
  boundsMaxY,
  frameTransformBoundsMinX,
  frameTransformBoundsMinY,
  frameTransformBoundsMaxX,
  frameTransformBoundsMaxY,
  onClose,
  activeProfile,
  onDisconnect,
  productionMode = false,
  userMode = 'beginner',
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
  isCompiling = false,
  compileProgress = null,
  isCompileCancelling = false,
  onCancelCompile,
  historyVersion = 0,
  onRecompile,
  onOpenSettings,
  sidebarWidth = 500,
  machineService,
  executionCoordinator,
  coordinatorSimulatorNotifyRef,
  outcomeReplaySection,
  messages,
  messageEvents = [],
  appendMessage,
  replaceMessages,
  clearMessages,
  isSimulator,
  setSimulator,
}: ConnectionPanelMainProps) {
  const [preflight, setPreflight] = useState<PreflightSummary | null>(null);
  const preflightRef = useRef<PreflightSummary | null>(null);
  const [showSimulator, setShowSimulator] = useState(false);
  const [detailsPanel, setDetailsPanel] = useState<ConnectionDetailsPanelKey | null>(null);
  const [jogStep, setJogStep] = useState(10);
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
  const [jobFailedRecoveryMessage, setJobFailedRecoveryMessage] = useState<string | null>(null);
  const [lastJobStartPosition, setLastJobStartPosition] = useState<LastMachinePosition | null>(null);
  // T1-50 Part A: UI mutex on Connect button. Without this, two
  // rapid clicks each call into `machineService.connectRealLaser()`,
  // each constructing a new WebSerialPort and racing on
  // `requestAndOpen` / `controller.connect`. The first wins; the
  // second's port stays opened and unowned. Mutex disables the
  // button while a connect is in flight; UI shows "Connecting…".
  // Part B wires a real USB cancel button to MachineService/WebSerialPort's
  // AbortSignal-aware cleanup path while a connect is in flight.
  const [connecting, setConnecting] = useState(false);
  const connectAbortRef = useRef<AbortController | null>(null);

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
  const simulatorListenersRef = useRef(new Set<(line: string) => void>());
  const jobStartTimeRef = useRef<number | null>(null);
  const jobProgressRef = useRef<JobProgress | null>(null);
  const elapsedSecondsRef = useRef(0);
  const jobStoppedByUserRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const hasFramed = useRef(false);
  const currentFrameAnchorRef = useRef<CurrentFrameAnchor | null>(null);
  const lastFrameTicketRef = useRef<FrameTicket | null>(null);

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
    setDetailsPanel(null);
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

  const preflightMachinePresent = machineState != null;
  const preflightMachineStatus = machineState?.status ?? null;
  const preflightMachineAlarm = machineState?.alarmCode ?? null;
  const preflightPlanMinX = machinePlanBounds?.minX ?? null;
  const preflightPlanMinY = machinePlanBounds?.minY ?? null;
  const preflightPlanMaxX = machinePlanBounds?.maxX ?? null;
  const preflightPlanMaxY = machinePlanBounds?.maxY ?? null;
  const preflightGcodeHeaderTemplate = activeProfile?.gcodeHeaderTemplate ?? null;
  const unsafeAtConnectVerdict = controllerRef.current?.getUnsafeAtConnect?.() ?? null;
  const unsafeAtConnectReason = unsafeAtConnectVerdict?.reason ?? null;

  useEffect(() => {
    const ctrlMaxSpindle = controllerRef.current?.maxSpindle;
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
      unsafeAtConnectReason,
      startMode,
      savedOrigin,
      // T1-218 (v30 audit #1): tell preflight whether the bed
      // dimensions are real or a 300mm fallback.
      bedDimensionsKnown,
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
    unsafeAtConnectReason,
    compiledJobTicket,
    startMode,
    savedOrigin,
    bedDimensionsKnown,
  ]);

  const isConnected = machineState?.status !== 'disconnected' && machineState?.status !== 'connecting' && machineState !== null;
  const isRunning = controllerRef.current?.isJobRunning || false;
  const displayPaused = isPaused || machineState?.status === 'hold';
  const showAutoFocus = activeProfile?.autoFocusSupported === true;
  const currentMachinePosition = useMemo(
    () => machinePosition ?? (machineState ? { x: machineState.position.x, y: machineState.position.y } : null),
    [machinePosition, machineState],
  );

  useEffect(() => {
    if (!isConnected || isRunning || displayPaused) {
      setDetailsPanel(null);
    }
  }, [displayPaused, isConnected, isRunning]);

  useEffect(() => {
    if (isConnected) {
      wasConnectedRef.current = true;
      intentionalDisconnectRef.current = false;
      setConnectionRecoveryVisible(false);
      return;
    }

    setLastJobStartPosition(null);
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
  // `activeOperation` and `recoveryPending` are read once per render
  // (not from React state) because their transitions are driven by
  // machineState changes (which already trigger re-renders) or by
  // long-lived modals that block UI input directly. Future work may add
  // an explicit subscription if non-modal recovery surfaces (T3-91)
  // need it.
  const activeOperation = machineService.getActiveOperation();
  const recoveryPending = getUnsafePriorState() != null;
  const laserOutputForGates = machineService.getLaserOutputState();
  const gates = machineState
    ? computeCommandGates({
        state: machineState,
        laserOutput: laserOutputForGates,
        activeOperation,
        recoveryPending,
      })
    : null;
  const canAutoFocus = gates?.baseSafe ?? false;
  const canHome =
    isConnected
    && activeProfile?.homingEnabled === true
    && activeOperation === null
    && machineState != null
    && machineState.status !== 'run'
    && machineState.status !== 'hold';
  const lastPositionMoves = buildGoToLastPositionJogs({
    current: currentMachinePosition,
    target: lastJobStartPosition,
  });
  const canGoToLastPosition =
    isConnected
    && !isRunning
    && !displayPaused
    && (gates?.canJog ?? false)
    && lastJobStartPosition != null
    && currentMachinePosition != null
    && lastPositionMoves.length > 0;
  const lastPositionLabel = lastJobStartPosition
    ? describeLastMachinePosition(lastJobStartPosition)
    : 'No last job start position recorded';

  useEffect(() => {
    if (isConnected) {
      hasFramed.current = false;
      currentFrameAnchorRef.current = null;
      lastFrameTicketRef.current = null;
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
    currentFrameAnchorRef.current = null;
    lastFrameTicketRef.current = null;
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
      currentFrameAnchorRef.current = null;
      lastFrameTicketRef.current = null;
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
        setJobFailedRecoveryMessage(null);
        setJobCompleted(true);
        setCompletedTime(Math.max(0, elapsedAtEnd));
        setProgressFlashGreen(true);
        window.setTimeout(() => setProgressFlashGreen(false), 1400);
      } else if (!stopped) {
        setJobFailedRecoveryMessage(
          jp != null
            ? `Job ended before completion (${jp.linesAcknowledged}/${jp.totalLines} lines acknowledged).`
            : 'Job ended before completion.',
        );
      } else {
        setJobFailedRecoveryMessage(null);
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

  const frameTransformBounds = useMemo(
    () => ({
      minX: frameTransformBoundsMinX ?? sceneBounds.minX,
      minY: frameTransformBoundsMinY ?? sceneBounds.minY,
      maxX: frameTransformBoundsMaxX ?? sceneBounds.maxX,
      maxY: frameTransformBoundsMaxY ?? sceneBounds.maxY,
    }),
    [
      frameTransformBoundsMinX,
      frameTransformBoundsMinY,
      frameTransformBoundsMaxX,
      frameTransformBoundsMaxY,
      sceneBounds.minX,
      sceneBounds.minY,
      sceneBounds.maxX,
      sceneBounds.maxY,
    ],
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
    const corners = buildFrameCorners(sceneBounds, transformOpts, frameTransformBounds);
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
    sceneBounds,
    frameTransformBounds,
  ]);

  const framePhysicalBounds = useMemo(() => {
    const workOrigin =
      startMode === 'current'
        ? machineState?.position ?? null
        : startMode === 'savedOrigin'
          ? savedOrigin
          : null;
    return physicalBoundsFromWorkBounds(frameMachineBounds, startMode, workOrigin);
  }, [
    frameMachineBounds,
    startMode,
    machineState?.position,
    savedOrigin,
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

  const acknowledgeReconnectRecovery = useCallback(() => {
    const recovery = machineService.getRecoveryState();
    if (
      (recovery.status === 'disconnectDuringJob' || recovery.status === 'emergencyStopped') &&
      !recovery.reconnectDone
    ) {
      machineService.applyRecoveryAck('reconnect');
      appendMessage('Recovery step acknowledged: reconnect complete.');
    }
  }, [appendMessage, machineService]);

  const hasRememberedUsbDevice = activeProfile?.connection?.kind === 'serial'
    && activeProfile.connection.fingerprint != null
    && (
      typeof activeProfile.connection.fingerprint.usbVendorId === 'number'
      || typeof activeProfile.connection.fingerprint.usbProductId === 'number'
    );

  const forgetUsbDevice = useCallback(async () => {
    if (!hasRememberedUsbDevice || activeProfile?.connection?.kind !== 'serial') return;
    const serialConnection = activeProfile.connection;
    const fingerprint = serialConnection.fingerprint;
    try {
      const forgotten = await WebSerialPort.forgetKnownPorts(fingerprint);
      saveDeviceProfile({
        ...activeProfile,
        connection: {
          ...serialConnection,
          fingerprint: undefined,
        },
      });
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event(ACTIVE_PROFILE_CHANGED_EVENT));
      }
      appendMessage(
        forgotten > 0
          ? `Forgot ${forgotten} saved USB laser grant${forgotten === 1 ? '' : 's'}.`
          : 'Cleared saved USB laser for this profile.',
      );
    } catch (e: any) {
      appendMessage(`Forget saved USB laser failed: ${e?.message ?? String(e)}`);
    }
  }, [activeProfile, appendMessage, hasRememberedUsbDevice]);

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
      acknowledgeReconnectRecovery();
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
    const connectAbortController = new AbortController();
    connectAbortRef.current = connectAbortController;
    setConnecting(true);
    try {
      appendMessage('Port opened, waiting for GRBL welcome...');
      await machineService.connectRealLaser(activeProfile?.baudRate ?? 115200, connectAbortController.signal);
      setSimulator(false);
      appendMessage('✓ Real laser connected via USB');
      acknowledgeReconnectRecovery();
    } catch (e: any) {
      if (connectAbortController.signal.aborted) {
        appendMessage('Connection cancelled by user');
      } else {
        appendMessage(`Connection failed: ${e.message}`);
      }
    } finally {
      if (connectAbortRef.current === connectAbortController) {
        connectAbortRef.current = null;
      }
      setConnecting(false);
    }
  };

  const cancelConnect = useCallback(() => {
    const connectAbortController = connectAbortRef.current;
    if (!connectAbortController || connectAbortController.signal.aborted) return;
    connectAbortController.abort(new Error('Connection cancelled by user'));
  }, []);

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
    setLastJobStartPosition(null);
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
    async (axis: 'X' | 'Y', distance: number) => {
      // T1-104: Jog requires exact idle. T1-105: hasJogged flips only
      // after the command is accepted by the transport.
      if (machineState?.status !== 'idle') {
        setMessages(prev => [...prev,
          `⚠ Jog declined: machine is "${machineState?.status ?? 'unknown'}", must be idle`,
        ]);
        return;
      }
      const result = await executionCoordinator.jog(axis, distance, 3000);
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

  const handleGoToLastPosition = useCallback(async () => {
    if (!lastJobStartPosition) {
      setMessages(prev => [...prev, 'No last job start position recorded yet.']);
      return;
    }
    if (!currentMachinePosition) {
      setMessages(prev => [...prev, 'Cannot go to last position: current machine position is unknown.']);
      return;
    }
    if (machineState?.status !== 'idle' || !(gates?.canJog ?? false)) {
      setMessages(prev => [...prev,
        `Go to last position declined: machine is "${machineState?.status ?? 'unknown'}", must be idle and safe to jog.`,
      ]);
      return;
    }

    const moves = buildGoToLastPositionJogs({
      current: currentMachinePosition,
      target: lastJobStartPosition,
    });
    if (moves.length === 0) {
      setMessages(prev => [...prev, `Already at last position (${describeLastMachinePosition(lastJobStartPosition)}).`]);
      return;
    }

    for (const move of moves) {
      const result = await executionCoordinator.jog(move.axis, move.distance, 3000);
      if (!result.ok) {
        setMessages(prev => [...prev,
          `Go to last position failed on ${move.axis}: ${result.reason ?? 'unknown'}. Check connection and machine state.`,
        ]);
        return;
      }
    }

    hasJogged.current = true;
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, `Moved to last position (${describeLastMachinePosition(lastJobStartPosition)}).`]);
  }, [
    currentMachinePosition,
    executionCoordinator,
    gates?.canJog,
    lastJobStartPosition,
    machineState?.status,
    setMessages,
  ]);

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
    if (startMode === 'current' && gcode && estimateJobTime(gcode).totalSeconds > 5 * 60) {
      let shouldShowProductionTip = true;
      try {
        shouldShowProductionTip = localStorage.getItem(CURRENT_MODE_LONG_JOB_TIP_KEY) !== 'true';
      } catch {
        shouldShowProductionTip = true;
      }
      if (shouldShowProductionTip) {
        await showAlert(
          'Production positioning tip',
          'For longer jobs and repeat burns, Set Origin and Use saved zero point are more repeatable than Start from laser head. Head mode is still fine for quick one-off jobs, alignment tests, and prototypes.',
          'See docs/PRODUCTION_RUNS.md for the recommended production workflow.',
        );
        try {
          localStorage.setItem(CURRENT_MODE_LONG_JOB_TIP_KEY, 'true');
        } catch {
          /* localStorage may be unavailable in tests or hardened browser modes. */
        }
      }
    }
    setMessages(prev => [
      ...prev,
      `Starting job: ${lines.length} commands (readiness: ${preflight?.score ?? '?'}%, ticket ${ticket.ticketId})`,
    ]);
    setJobFailedRecoveryMessage(null);
    const jobStartPosition = captureLastJobStartPosition(machinePosition ?? machineState?.position ?? null);
    try {
      const canvasContext = {
        canvasMoves: lastGcodeCompileResult.canvasMoves,
        canvasPlanBounds: lastGcodeCompileResult.canvasPlanBounds,
        machineTransform: lastGcodeCompileResult.machineTransform,
      };
      const frameTicketValidation = validateFrameTicketForStart({
        frameTicket: lastFrameTicketRef.current,
        jobTicketId: ticket.ticketId,
        fingerprint: ticket.fingerprint,
      });
      const freshFrameTicket =
        frameTicketValidation.ok && !frameTicketValidation.override
          ? lastFrameTicketRef.current
          : null;
      const frameTicket = freshFrameTicket
        ?? ((!requireFrame && userModeGatePolicy.allowStartWithoutFraming)
          ? createUnframedStartOverrideTicket({
              jobTicketId: ticket.ticketId,
              fingerprint: ticket.fingerprint,
              reason: userModeGatePolicy.startWithoutFramingLabel ?? 'Start without framing selected',
            })
          : null);
      await executionCoordinator.startValidatedJob({
        ticket,
        scene,
        machineState,
        notifySimulatorTx,
        canvasContext,
        currentStartMode: startMode,
        currentSavedOrigin: savedOrigin,
        frameTicket,
        outputFormat: 'grbl',
      });
      if (jobStartPosition) {
        setLastJobStartPosition(jobStartPosition);
      }
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
      setJobFailedRecoveryMessage(`Job failed to start: ${msg}`);
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
    const x1 = framePhysicalBounds.minX;
    const y1 = framePhysicalBounds.minY;
    const x2 = framePhysicalBounds.maxX;
    const y2 = framePhysicalBounds.maxY;

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
  }, [framePhysicalBounds, bedWidth, bedHeight, showAlert, showConfirm]);

  /**
   * T1-41-followup: verify saved-origin G54 before frame motion. The
   * inline check at job-start (~line 1086) covers Start; this helper
   * applies the same logic to Frame Safe / Frame Dot. Without it, a
   * console `G10` / `G92` between Set Origin and Frame let the head
   * move with a drifted G54 — exactly the wall-crash a 2026-05-12
   * Falcon hardware test surfaced.
   *
   * Returns `true` when the verification passes (or doesn't apply
   * because `startMode !== 'savedOrigin'`); `false` when the check
   * failed and an alert was already shown to the user.
   */
  const verifySavedOriginForFrame = useCallback(async (): Promise<boolean> => {
    if (startMode !== 'savedOrigin') return true;
    const expectedG54 = machineService.getSavedOriginG54Snapshot();
    const currentG54 = await machineService.requestWorkOffsets();
    const verified = verifySavedOriginG54(expectedG54, currentG54);
    if (verified.ok) return true;
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
    return false;
  }, [startMode, machineService, showAlert, setMessages]);

  const handleFrameSafe = useCallback(async (): Promise<boolean> => {
    if (!canFrame) return false;

    // T1-41-followup: refuse Frame when saved-origin G54 has drifted
    // since Set Origin (e.g. user typed G10 / G92 in the console).
    // Same check as the Start handler; runs before bounds confirmation
    // so a drifted G54 surfaces a clear "saved origin invalid" alert
    // instead of an off-bed bounds alert.
    if (!(await verifySavedOriginForFrame())) return false;

    if (!(await confirmFrameBounds())) return false;

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
    const frameStartPosition = machineState?.position
      ? { x: machineState.position.x, y: machineState.position.y }
      : null;

    const corners = buildFrameCorners(sceneBounds, transformOpts, frameTransformBounds);

    const ys = corners.map(c => c.y);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);

    // T1-98: estimate idle timeout from corner travel distance instead
    // of using a fixed 15s deadline that can expire mid-frame.
    const idleTimeoutMs = estimateFrameIdleTimeoutMs(corners);

    setMessages(prev => [...prev,
      `Framing (safe): machine X${corners[0]!.x.toFixed(0)}-${corners[1]!.x.toFixed(0)} Y${yLo.toFixed(0)}-${yHi.toFixed(0)}`,
    ]);

    // T1-172 (audit F-017): pass the profile's frame-line delay so
    // fast firmware can drop toward 0 ms while slow firmware can
    // raise it. Pre-T1-172 this was hardcoded 50 ms inside the
    // coordinator with no profile override.
    const frameLineDelayMs = resolveFrameLineDelayMs(activeProfile);
    const result = await executionCoordinator.frameSafe({
      sceneBounds,
      transformReferenceBounds: frameTransformBounds,
      transformOpts,
      idleTimeoutMs,
      frameLineDelayMs,
    });

    if (!result.ok) {
      const timeoutSec = Math.round(idleTimeoutMs / 1000);
      setFrameRecoveryTimeoutSec(timeoutSec);
      setMessages(prev => [...prev, frameFailureLogLine(result, 'Frame (Safe)', timeoutSec)]);
      return false;
    }

    hasFramed.current = true;
    currentFrameAnchorRef.current = captureCurrentFrameAnchor(startMode, frameStartPosition);
    lastFrameTicketRef.current = compiledJobTicket
      ? createFramedStartTicket({
          jobTicketId: compiledJobTicket.ticketId,
          fingerprint: compiledJobTicket.fingerprint,
          machineBounds: framePhysicalBounds,
          mode: 'safe',
        })
      : null;
    setFrameRecoveryTimeoutSec(null);
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Safe) complete']);
    return true;
  }, [activeProfile, bedWidth, canFrame, compiledJobTicket, confirmFrameBounds, framePhysicalBounds, machineState?.position, sceneBounds, frameTransformBounds, startMode, savedOrigin, originCorner, bedHeight, executionCoordinator, setMessages, verifySavedOriginForFrame]);

  const handleFrameDot = useCallback(async () => {
    if (!canFrame) return;

    // T1-41-followup: same saved-origin G54 verification the Start
    // handler runs. A drifted G54 must block Frame Dot identically —
    // the laser-dot move is even more dangerous than the corner trace
    // because it fires power at a single point.
    if (!(await verifySavedOriginForFrame())) return;

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
    const frameStartPosition = machineState?.position
      ? { x: machineState.position.x, y: machineState.position.y }
      : null;

    const corners = buildFrameCorners(sceneBounds, transformOpts, frameTransformBounds);

    const ys = corners.map(c => c.y);
    const yLo = Math.min(...ys);
    const yHi = Math.max(...ys);

    setMessages(prev => [...prev,
      `Framing (laser dot): machine X${corners[0]!.x.toFixed(0)}-${corners[1]!.x.toFixed(0)} Y${yLo.toFixed(0)}-${yHi.toFixed(0)}`,
    ]);

    const maxSpindle = activeProfile?.maxSpindle ?? 1000;
    const frameDotFeedRateMmPerMin = resolveFrameDotFeedRate(activeProfile);
    // T1-172 (audit F-017): same profile-driven line-delay as frameSafe.
    const frameLineDelayMs = resolveFrameLineDelayMs(activeProfile);

    const result = await executionCoordinator.frameDot({
      sceneBounds,
      transformReferenceBounds: frameTransformBounds,
      transformOpts,
      maxSpindle,
      frameDotFeedRateMmPerMin,
      frameLineDelayMs,
    });

    if (!result.ok) {
      setFrameRecoveryTimeoutSec(15);
      setMessages(prev => [...prev, frameFailureLogLine(result, 'Frame (Laser Dot)', 15)]);
      return;
    }

    hasFramed.current = true;
    currentFrameAnchorRef.current = captureCurrentFrameAnchor(startMode, frameStartPosition);
    lastFrameTicketRef.current = compiledJobTicket
      ? createFramedStartTicket({
          jobTicketId: compiledJobTicket.ticketId,
          fingerprint: compiledJobTicket.fingerprint,
          machineBounds: framePhysicalBounds,
          mode: 'dot',
        })
      : null;
    setFrameRecoveryTimeoutSec(null);
    setWorkflowVersion(v => v + 1);
    setMessages(prev => [...prev, '✓ Frame (Laser Dot) complete']);
  }, [activeProfile, bedWidth, canFrame, compiledJobTicket, confirmFrameBounds, framePhysicalBounds, machineState?.position, sceneBounds, frameTransformBounds, startMode, savedOrigin, originCorner, bedHeight, executionCoordinator, setMessages, verifySavedOriginForFrame]);

  const handleHome = useCallback(async (): Promise<boolean> => {
    if (!canHome) {
      setMessages(prev => [
        ...prev,
        'Home disabled for this profile. Use manual zero until homing settings are verified.',
      ]);
      return false;
    }
    const ok = await showConfirm('Homing', 'Homing moves to limit switches. Continue?');
    if (!ok) return false;
    try {
      await executionCoordinator.home();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => [...prev, `âš  Homing failed: ${msg}`]);
      await showAlert('Homing failed', msg);
      return false;
    }
  }, [canHome, showAlert, showConfirm, executionCoordinator, setMessages]);

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

  const handleUnlock = useCallback(async (): Promise<boolean> => {
    const classification = machineService.classifyUserCommand(GRBL_USER_LINE_FOR_UNLOCK_CLASSIFY);
    const ok = await showConfirm(
      'Dangerous command',
      `${classification.reason}\n\nSend "${classification.command}" anyway?`,
    );
    if (!ok) {
      appendMessage(`Blocked: ${classification.command}`);
      return false;
    }
    try {
      await executionCoordinator.unlock();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      appendMessage(`âš  Unlock failed: ${msg}`);
      await showAlert('Unlock failed', msg);
      return false;
    }
  }, [appendMessage, machineService, showAlert, showConfirm, executionCoordinator]);

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
        await machineService.resume();
      } else {
        await machineService.pause();
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

  const handleRecoveryAction = useCallback((action: RecoveryAction) => {
    void (async () => {
      // T1-242: recovery cards are not just command shortcuts. They
      // are the visible UI for RecoveryState's typed checklist, so
      // successful actions must acknowledge the matching runtime step.
      switch (action) {
        case 'inspect':
          machineService.applyRecoveryAck('inspection');
          appendMessage('Recovery step acknowledged: inspection complete.');
          break;
        case 'unlock':
          if (await handleUnlock()) {
            machineService.applyRecoveryAck('unlock');
            appendMessage('Recovery step acknowledged: alarm cleared.');
          }
          break;
        case 'home':
        case 're-home':
          if (canHome) {
            if (await handleHome()) {
              machineService.applyRecoveryAck('rehome');
              appendMessage('Recovery step acknowledged: position re-homed.');
            }
          } else {
            const ok = await showConfirm(
              'Manual position recovery',
              'This profile has homing disabled. Confirm you have manually re-established a safe zero point or verified the machine position before continuing.',
            );
            if (ok) {
              machineService.applyRecoveryAck('rehome');
              appendMessage('Recovery step acknowledged: position verified manually.');
            }
          }
          break;
        case 'frame':
        case 'reframe':
          if (await handleFrameSafe()) {
            machineService.applyRecoveryAck('reframe');
            appendMessage('Recovery step acknowledged: frame complete.');
          }
          break;
        case 'reconnect':
          await machineService.disconnect();
          setConnectionRecoveryVisible(false);
          appendMessage('Reconnect required: choose USB laser or Simulator to confirm recovery.');
          break;
        case 'stop':
          await handleStop();
          break;
        case 'compile':
          setJobFailedRecoveryMessage(null);
          if (!onRecompile) {
            appendMessage('Recovery step not acknowledged: no recompile action is available.');
            break;
          }
          try {
            const recompileOk = await onRecompile?.();
            if (recompileOk !== false) {
              machineService.applyRecoveryAck('recompile');
              appendMessage('Recovery step acknowledged: job recompiled.');
            } else {
              appendMessage('Recovery step not acknowledged: recompile did not produce G-code.');
            }
          } catch (err: unknown) {
            appendMessage(`Recovery step not acknowledged: ${err instanceof Error ? err.message : String(err)}`);
          }
          break;
        default:
          break;
      }
    })();
  }, [
    appendMessage,
    canHome,
    handleFrameSafe,
    handleHome,
    handleStop,
    handleUnlock,
    machineService,
    onRecompile,
    showConfirm,
  ]);

  const handleUnsafeAtConnectAction = useCallback((kind: UnsafeAtConnectActionKind) => {
    void (async () => {
      try {
        switch (kind) {
          case 'reset':
            // T3-91 follow-up: use the same confirmed Unlock path as the
            // alarm recovery card; do not introduce a second raw-$X route.
            if (await handleUnlock()) {
              appendMessage('Unsafe-at-connect recovery: unlock sent. Wait for the controller to report Idle.');
            }
            break;
          case 'reconnect':
            await machineService.disconnect();
            setConnectionRecoveryVisible(false);
            appendMessage('Unsafe-at-connect recovery: disconnected. Reconnect to rerun the safe-state handshake.');
            break;
          case 'm5':
            // Use the structured laser-off path so M5 success/failure feeds
            // MachineService laser-output and safety-state tracking.
            await executionCoordinator.emergencyLaserOff();
            controllerRef.current?.requestStatusReport();
            appendMessage('Unsafe-at-connect recovery: laser-off command sent. Wait for the controller to report laser-off idle.');
            break;
        }
      } catch (err: unknown) {
        appendMessage(`Unsafe-at-connect recovery failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [
    appendMessage,
    controllerRef,
    executionCoordinator,
    handleUnlock,
    machineService,
  ]);

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
  // T1-59 + T2-64: beginner mode requires a fresh frame before Start;
  // advanced mode can explicitly override that gate.
  const userModeGatePolicy = computeUserModeGatePolicy(userMode);
  const requireFrame = userModeGatePolicy.requireFrameBeforeStart;
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
  // T1-203: surface the reason behind placement-uncertain so the
  // start-readiness gate can tailor the failHeadline + failAction to
  // the actual cause (alarm / firmware quirk / cable noise / listener
  // race), not the misleading one-size-fits-all "no consent prompt"
  // message every cause used to share.
  const placementUncertainReason =
    (controllerRef.current?.getPlacementUncertainReason?.() ?? null) as
      | WcsUncertainReason
      | null;
  // T1-122: live RecoveryState. Pre-T1-122 the runtime RecoveryState
  // type was defined but no production owner held an instance and no
  // canonical canStartJob consulted `recoveryAllowsStart`. Now
  // MachineService owns the state; this subscription is the UI half
  // of the wiring so the start button refuses while recovery is
  // incomplete (alarm pending acknowledgement, disconnect-during-job
  // not yet rehomed, etc.) regardless of what the live controller
  // status reports.
  const [recoveryState, setRecoveryStateLocal] = useState(
    () => machineService.getRecoveryState(),
  );
  useEffect(() => {
    setRecoveryStateLocal(machineService.getRecoveryState());
    return machineService.onRecoveryStateChange(setRecoveryStateLocal);
  }, [machineService]);
  // T1-123: live WiFi trust verdict + override snapshot. Pre-T1-123
  // the panel never showed trust at all — the user couldn't tell a
  // USB connection (trusted local control) from a Falcon WiFi
  // connection (unauthenticated, attacker-spoofable per audit 5D
  // Critical 10). The badge below renders the trust label;
  // canStartJob conjuncts off the service's combined trust+override
  // policy evaluation so the Start button refuses over WiFi until
  // the user grants an explicit override.
  const [wifiOverride, setWiFiOverrideLocal] = useState(
    () => machineService.getWiFiOverride(),
  );
  useEffect(() => {
    setWiFiOverrideLocal(machineService.getWiFiOverride());
    return machineService.onWiFiOverrideChange(setWiFiOverrideLocal);
  }, [machineService]);
  void wifiOverride; // referenced via re-render trigger; the gate reads via service
  const wifiTrust = machineService.getConnectionTrust();
  const wifiStartAllowed = machineService.evaluateActionAllowed('start-job').allowed;
  const currentModeFrameAnchorValid =
    !requireFrame ||
    currentModeFrameAnchorAllowsStart({
      startMode,
      frameAnchor: currentFrameAnchorRef.current,
      machinePosition,
    });
  // T1-30: canStartJob keeps its existing product-level conjuncts
  // (gcode exists / fresh / framed / preflight passed / not running /
  // machine bounds OK / laser output confirmed off / WCS not uncertain)
  // and adds `gates.baseSafe` as a defense-in-depth conjunct. baseSafe
  // collapses status === 'idle', laserOutput === 'off', no active
  // operation, no error code, and no pending recovery into one check;
  // each of those now has a matching visible readiness row
  // (machine idle, laser off, active operation, controller error, and
  // recovery state), so consolidating here makes the safety story
  // legible and prevents drift if any upstream gate weakens.
  const canStartJob =
    !!gcode &&
    !isRunning &&
    !!preflight?.canStart &&
    !gcodeStale &&
    !machineBlocksJobStart &&
    (!requireFrame || hasFramed.current) &&
    currentModeFrameAnchorValid &&
    laserOutputState !== 'unknown' &&
    !placementUncertain &&
    // T1-122: recovery checklist must be complete. recoveryAllowsStart
    // returns true exactly when state.status === 'none' (every required
    // step for the active recovery has been acknowledged). Audit Phase
    // 2 #6: previously this conjunct was missing entirely, so the UI
    // would re-enable Start as soon as the controller cleared back to
    // idle even though the user hadn't acknowledged inspection /
    // rehome / reframe.
    recoveryAllowsStart(recoveryState) &&
    // T1-123: connection-trust gate. Trusted (USB) connections pass
    // automatically; Falcon WiFi connections need an explicit override
    // grant. Audit Phase 2 #7: previously trust was never consulted
    // by the start gate, so a job could go out over an unauthenticated
    // WiFi connection without the user's awareness.
    wifiStartAllowed &&
    (gates?.baseSafe ?? false);
  /**
   * T1-96: structured Start-button readiness for the diagnostics panel.
   *
   * Each gate corresponds 1:1 with a conjunct in `canStartJob` above.
   * `blockingGate` is the first failing gate; it drives the collapsed
   * headline. When `canStartJob` is true, `ready` is true and the panel
   * renders nothing.
   */
  // T1-129: readiness derivation moved to the pure helper
  // `buildStartReadiness` (src/ui/components/connection/buildStartReadiness.ts).
  // Pre-T1-129 this was a 142-line IIFE inline in this file; the
  // logic was already pure but mounted alongside the rest of the
  // panel's render code, making it untestable without a full
  // ConnectionPanelMain mount + 50 props of fixture data.
  const startReadiness: StartReadiness = buildStartReadiness({
    preflight,
    isConnected,
    machineState,
    machineStatus,
    laserOutputState,
    activeOperation,
    recoveryPending,
    gcode,
    gcodeStale,
    isSimulator,
    machineBlocksJobStart,
    canFrame,
    requireFrame,
    hasFramed: hasFramed.current,
    startMode,
    currentModeFrameAnchorValid,
    placementUncertain,
    placementUncertainReason,
    // T1-205: wire the "Reset WCS to baseline" recovery button.
    // applyWcsNormalization sends `G10 L2 P1 X0 Y0 Z0` + `$10=0`
    // and clears _placementUncertain locally — the gate flips to
    // ok without a reconnect cycle.
    onResetWcsToBaseline: () => {
      controllerRef.current?.applyWcsNormalization?.();
    },
    recoveryAllowsStart: recoveryAllowsStart(recoveryState),
    wifiTrust,
    wifiStartAllowed,
    isRunning,
    canStartJob,
  });
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
  const unsafeAtConnectBanner = isConnected && React.createElement(UnsafeAtConnectBanner, {
    unsafeVerdict: unsafeAtConnectVerdict,
    onRecoveryAction: handleUnsafeAtConnectAction,
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
    onCancelConnect: connectAbortRef.current ? cancelConnect : undefined,
    hasRememberedUsbDevice: hasRememberedUsbDevice,
    onForgetUsbDevice: hasRememberedUsbDevice ? () => { void forgetUsbDevice(); } : undefined,
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
  const jobTimeEstimate = useMemo(() => gcode ? estimateJobTime(gcode) : null, [gcode]);
  const estimatedTimeFormatted = jobTimeEstimate?.formatted ?? null;
  const jobComplexitySummary = useMemo(() => buildJobComplexitySummary({
    gcodeText: gcode,
    estimatedTimeSeconds: jobTimeEstimate?.totalSeconds ?? null,
    planStats: lastGcodeCompileResult?.machineTransform.plan.stats ?? null,
    scene,
  }), [gcode, jobTimeEstimate?.totalSeconds, lastGcodeCompileResult?.machineTransform.plan.stats, scene]);
  const readyOperationRows = useMemo(() => buildReadyOperationRows(scene), [scene]);
  const readyOperationAnalysis = useMemo(
    () => analyzeOperationOrder(readyOperationRows),
    [readyOperationRows],
  );
  const frameRecommended = !requireFrame && !hasFramed.current;
  const readyWarnings: ReadyToRunWarning[] = [
    ...startReadiness.gates
      .filter(gate => gate.status === 'fail')
      .map(gate => ({
        id: gate.id,
        severity: 'blocker' as const,
        text: gate.failHeadline ?? `${gate.label} is not ready`,
        action: gate.failAction,
      })),
    ...(frameRecommended
      ? [{
          id: 'framing-recommended',
          severity: 'warning' as const,
          text: 'Frame recommended before Start',
          action: 'Use Frame to verify the burn area when setup or material placement changed',
        }]
      : []),
  ];
  const readyBounds = lastGcodeCompileResult?.machinePlanBounds ?? machinePlanBounds ?? frameMachineBounds;
  const readyToRunData: ReadyToRunPanelData = {
    machine: {
      connectionLabel: isSimulator ? 'Connected (Sim)' : 'Connected',
      profileLabel: activeProfile?.name ?? scene.machine?.name ?? 'No profile selected',
      statusLabel: machineState?.status ?? 'unknown',
      bedLabel: `${fmtMm(bedWidth)} x ${fmtMm(bedHeight)} mm bed`,
      positionLabel: machinePosition
        ? `X${fmtMm(machinePosition.x)} Y${fmtMm(machinePosition.y)}`
        : 'Position unknown',
    },
    job: {
      summaryLabel: `${readyOperationRows.length} operation${readyOperationRows.length === 1 ? '' : 's'}`,
      boundsLabel: `X${fmtMm(readyBounds.minX)} Y${fmtMm(readyBounds.minY)} to X${fmtMm(readyBounds.maxX)} Y${fmtMm(readyBounds.maxY)}`,
      estimatedTimeLabel: estimatedTimeFormatted,
      operationAnalysis: readyOperationAnalysis,
      complexity: jobComplexitySummary,
    },
    material: {
      label: scene.material?.name ?? 'No material selected',
      sizeLabel: scene.material
        ? `${fmtMm(scene.material.width)} x ${fmtMm(scene.material.height)} x ${fmtMm(scene.material.thickness)} mm`
        : 'Not set',
      reminders: [
        { id: 'focus', label: 'Focus checked' },
        { id: 'hold-down', label: 'Material held flat' },
        { id: 'ventilation', label: 'Ventilation and air assist checked' },
      ],
    },
    position: {
      startModeLabel: readyStartModeLabel(startMode),
      originLabel: startPositionStatus,
      frameStatusLabel: hasFramed.current
        ? 'Frame complete'
        : (requireFrame ? 'Frame required before Start' : 'Frame recommended before Start'),
      layout: {
        bedWidth,
        bedHeight,
        startMode,
        originCorner,
        materialBounds: scene.material && scene.material.enabled !== false
          ? {
              minX: scene.material.x,
              minY: scene.material.y,
              maxX: scene.material.x + scene.material.width,
              maxY: scene.material.y + scene.material.height,
            }
          : null,
        jobBounds: readyBounds,
        frameBounds: framePhysicalBounds,
        savedOrigin,
        headPosition: machinePosition,
      },
    },
    warnings: readyWarnings,
    canStartJob,
    startBlockedReason: startReadiness.blockingGate?.failHeadline ?? null,
  };

  const saveOriginFromPanel = () => {
    hasSetOrigin.current = true;
    setWorkflowVersion(v => v + 1);
    onSaveOrigin();
  };

  const jobPositionSection = isConnected && React.createElement(JobPosition, {
    startMode,
    onSelectMode,
    startPositionStatus,
    machinePositionKnown: !!machinePosition,
    hasSetOrigin: hasSetOrigin.current,
    isConnected,
    onSaveOrigin: saveOriginFromPanel,
  });

  const workflowStepsSection = isConnected && React.createElement(React.Fragment, null,
    React.createElement(WorkflowSteps, {
      startMode,
      hasJogged: hasJogged.current,
      hasSetOrigin: hasSetOrigin.current,
      hasFramed: hasFramed.current,
      canStartJob,
      startJobDesc,
      estimatedTimeFormatted,
    }),
  );

  const controlsSection = isConnected && React.createElement('div', {
    style: { padding: '10px 16px 12px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('div', {
      style: { fontSize: 10, color: '#777798', marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: 0, fontWeight: 700 },
    }, 'Move Laser'),
    React.createElement('div', {
      style: { display: 'flex', gap: 16 },
    },
      React.createElement(Jog, {
        jogStep,
        setJogStep,
        onJog: handleJog,
        onHome: () => { void handleHome(); },
        canHome,
        canGoToLastPosition,
        lastPositionLabel,
        onGoToLastPosition: () => { void handleGoToLastPosition(); },
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
        React.createElement('div', {
          style: {
            display: 'flex',
            flexWrap: 'wrap' as const,
            gap: 6,
            fontSize: 10,
            color: '#8888aa',
            lineHeight: 1.4,
          },
        },
          React.createElement('span', null, m.toUpperCase()),
          React.createElement('span', null, `${Math.round(layer.settings.power.max)}%`),
          React.createElement('span', null, `${Math.round(layer.settings.speed)} mm/min`),
          React.createElement('span', null, `${Math.max(1, Math.round(layer.settings.passes))} pass${Math.max(1, Math.round(layer.settings.passes)) === 1 ? '' : 'es'}`),
          m === 'engrave' && React.createElement('span', null,
            `${layer.settings.fill.mode} fill @ ${(Number(layer.settings.fill.interval) > 0 ? layer.settings.fill.interval : 0.1).toFixed(2)}mm`,
          ),
          m === 'engrave' && React.createElement('span', null,
            layer.settings.fill.biDirectional !== false ? 'bidirectional' : 'one-way',
          ),
        ),
      ),
    );
  }

  const layerOverviewSection =
    isConnected &&
    !isRunning &&
    !displayPaused &&
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

  const compilePercent = Math.round((compileProgress?.overallFraction ?? 0) * 100);
  const compilePhaseLabel = compileProgress?.phase
    ? ({
        'text-expansion': 'Preparing text',
        'compile-job': 'Building job',
        plan: 'Optimizing path',
        transform: 'Mapping machine',
        output: 'Writing G-code',
      } as Record<CompileProgress['phase'], string>)[compileProgress.phase]
    : 'Compiling';
  const compileProgressSection = isConnected && !isRunning && (isCompiling || compileProgress) && React.createElement('div', {
    style: {
      margin: '0 16px 8px',
      padding: '10px 12px',
      background: 'rgba(0,212,255,0.06)',
      border: '1px solid rgba(0,212,255,0.24)',
      borderRadius: 6,
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        marginBottom: 8,
      },
    },
      React.createElement('div', { style: { minWidth: 0 } },
        React.createElement('div', { style: { fontSize: 11, color: '#c9f4ff', fontWeight: 700 } },
          isCompileCancelling ? 'Cancelling compile' : compilePhaseLabel,
        ),
        React.createElement('div', { style: { fontSize: 9, color: '#777798', marginTop: 2 } },
          compileProgress?.detail ?? `${compilePercent}%`,
        ),
      ),
      onCancelCompile && React.createElement('button', {
        type: 'button',
        onClick: onCancelCompile,
        disabled: isCompileCancelling,
        style: {
          padding: '6px 12px',
          fontSize: 11,
          fontWeight: 700,
          borderRadius: 6,
          cursor: isCompileCancelling ? 'default' : 'pointer',
          fontFamily: font,
          background: isCompileCancelling ? 'rgba(85,85,112,0.22)' : 'rgba(255,68,102,0.10)',
          border: isCompileCancelling ? '1px solid rgba(85,85,112,0.4)' : '1px solid rgba(255,68,102,0.65)',
          color: isCompileCancelling ? '#777798' : '#ff6b89',
          flexShrink: 0,
        },
      }, isCompileCancelling ? 'Cancelling' : 'Cancel'),
    ),
    React.createElement('div', {
      style: {
        width: '100%',
        height: 6,
        borderRadius: 999,
        background: 'rgba(255,255,255,0.08)',
        overflow: 'hidden',
      },
    },
      React.createElement('div', {
        style: {
          width: `${compilePercent}%`,
          height: '100%',
          background: '#00d4ff',
          transition: 'width 120ms linear',
        },
      }),
    ),
  );

  const issuesSection = isConnected && !isRunning && !displayPaused && React.createElement(Issues, {
    issues,
    readinessScore,
  });

  const detailLaunchersSection = isConnected && !isRunning && !displayPaused &&
    React.createElement(JobDetailsLaunchers, {
      issueCount: issues.length,
      onOpen: setDetailsPanel,
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

  const jobFailedRecoveryContent = jobFailedRecoveryMessage != null
    ? buildRecoveryCard({ variant: 'job-failed', errorMessage: jobFailedRecoveryMessage })
    : null;
  const jobFailedRecoveryCard = jobFailedRecoveryContent &&
    React.createElement(RecoveryCard, {
      content: jobFailedRecoveryContent,
      onAction: handleRecoveryAction,
    });

  const safetyRecoveryContent = safetyState.kind === 'requiresInspection'
    ? buildRecoveryCard({ variant: 'emergency-stop' })
    : null;
  const safetyRecoveryCard = safetyRecoveryContent &&
    React.createElement(RecoveryCard, {
      content: safetyRecoveryContent,
      onAction: handleRecoveryAction,
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
    startButtonLabel: !requireFrame && !hasFramed.current && userModeGatePolicy.startWithoutFramingLabel
      ? userModeGatePolicy.startWithoutFramingLabel
      : undefined,
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

  const advancedMachineDetailsSection = isConnected && React.createElement('div', {
    style: {
      padding: '10px 16px 12px',
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 8,
    },
  },
    React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column' as const, gap: 8 },
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
      false && productionMode && React.createElement('div', {
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
      false && !productionMode && messages.length > 0 && React.createElement('div', {
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

  const readyToRunSection = isConnected && !isRunning && !displayPaused && gcode && !gcodeStale &&
    React.createElement(ReadyToRunPanel, {
      data: readyToRunData,
      startLabel: `START${isSimulator ? ' (Sim)' : ''}`,
      onStartJob: () => { void handleStartJob(); },
    });

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

  const advancedSection = isConnected && React.createElement(ConsolePanel, {
    isConnected,
    isRunning,
    controller: controllerRef.current,
    sendUserCommand: sendCmd,
    advancedSection: advancedMachineDetailsSection,
    simulatorView,
    messageEvents,
  });

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
        alarmBanner: detailsPanel == null ? alarmBanner : null,
        faultedBanner: detailsPanel == null ? faultedBanner : null,
        unsafeAtConnectBanner: detailsPanel == null ? unsafeAtConnectBanner : null,
        laserModeBanner: detailsPanel == null ? laserModeBanner : null,
        connectSection,
      }),
      // T1-214: keep recovery cards pinned at the top (always visible
      // regardless of how much prep content there is), but move the
      // prep sections (profile + controls + job position + detail
      // launchers + ready-to-run + move controls) into the single
      // scrollable middle area below. Pre-T1-214 each prep section
      // was its own flex sibling with no `flex-shrink: 0`, so they
      // collectively pushed JobControls + E-Stop off-screen on smaller
      // windows. Now only the scrollable middle absorbs height
      // pressure; the E-Stop button at the bottom is always visible.
      detailsPanel == null && connectionRecoveryCard,
      detailsPanel == null && frameRecoveryCard,
      detailsPanel == null && jobFailedRecoveryCard,
      detailsPanel == null && safetyRecoveryCard,
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
        detailsPanel != null
          ? React.createElement(ConnectionDetailsPanel, {
              activePanel: detailsPanel,
              issueCount: issues.length,
              onSelect: setDetailsPanel,
              onClose: () => setDetailsPanel(null),
              workflowSection: workflowStepsSection,
              issuesSection,
              advancedSection,
            })
          : React.createElement(React.Fragment, null,
              profileSection,
              !isRunning && !displayPaused && controlsSection,
              !isRunning && !displayPaused && jobPositionSection,
              !isRunning && !displayPaused && detailLaunchersSection,
              readyToRunSection,
              React.createElement(MoveControls, {
                isConnected,
                layerOverviewSection,
                gcodeWarning,
                compileProgressSection,
                outcomeExtrasSection,
              }),
            ),
      ),
      // T1-214: wrap JobControls + E-Stop in a single bottom bar
      // with flexShrink: 0 so they form an indivisible footer that
      // cannot be pushed off-screen by the scrollable middle. The
      // E-Stop button's own flexShrink:0 wasn't enough — its
      // parent (the panel root) didn't reserve space for it when
      // the middle column overflowed.
      React.createElement('div', {
        style: { flexShrink: 0, display: 'flex', flexDirection: 'column' as const },
      },
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
          'data-testid': 'connection-emergency-stop',
          onClick: async () => {
            jobStoppedByUserRef.current = true;
            stopTestFire();
            const result = await machineService.emergencyStop();
            void showAlert(
              result.accepted ? 'Emergency stop' : 'Emergency stop failed',
              result.message
                ?? (result.accepted
                  ? 'The machine was reset and the connection was closed. Reconnect when it is safe to continue.'
                  : 'The controller did not accept the emergency stop. Use the physical E-stop or power disconnect, then inspect the machine before reconnecting.'),
            );
            portRef.current = null;
            setIsPaused(false);
            setLastJobStartPosition(null);
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
      ), // T1-214: close the bottom-bar wrapper added above.
    ),
  );
}
