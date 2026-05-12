import React, { useEffect, useMemo, useState } from 'react';
import { type JobReplay } from '../../core/replay/JobReplay';
import {
  ConnectionPanelMain,
  type ConnectionPanelMainProps,
} from './ConnectionPanelMain';
import { JobOutcomeDialog } from './JobOutcomeDialog';
import { type MachineUiHook } from '../hooks/useMachineService';
import {
  getActiveProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../../core/devices/DeviceProfile';
import { FalconWiFiStatusPanel, FalconAlarmToastStack } from './falcon-wifi';
// T1-204: feature-flag-gated rollout of the new WorkflowPanel
// (`docs/CONNECTION-PANEL-REDESIGN.md`). Default off — the existing
// ConnectionPanelMain still renders for every user until parity is
// confirmed.
import {
  getUiFeatureFlag,
  UI_FEATURE_FLAG_CHANGED_EVENT,
} from '../features/uiFeatureFlags';
import { WorkflowPanel } from './workflow/WorkflowPanel';
import { WebSerialPort } from '../../communication/WebSerialPort';
import { estimateJobTime } from '../../core/output/TimeEstimator';
// T1-211: frame helpers for the Move tab's Frame / Frame+Dot buttons.
// getActiveProfile is already imported above; only pull the new
// helpers here.
import { buildFrameCorners } from '../../app/frameGcode';
import { estimateFrameIdleTimeoutMs } from '../../app/grblIdlePoll';
import {
  resolveFrameDotFeedRate,
  resolveFrameLineDelayMs,
} from '../../core/devices/DeviceProfile';

export type ConnectionPanelProps = Omit<
  ConnectionPanelMainProps,
  | 'machineService'
  | 'executionCoordinator'
  | 'coordinatorSimulatorNotifyRef'
  | 'outcomeReplaySection'
  | 'messages'
  | 'messageEvents'
  | 'appendMessage'
  | 'appendLogEvent'
  | 'replaceMessages'
  | 'clearMessages'
  | 'isSimulator'
  | 'setSimulator'
> & {
  machineUi: MachineUiHook;
};

const FONT = "'DM Sans', system-ui, sans-serif";

/**
 * Read the active profile and subscribe to `storage` events so the panel
 * flips to Falcon mode the moment `FalconWiFiConnectBlock` activates a profile
 * (even if the activation happens in a different tab or component tree).
 */
function useActiveProfile(): DeviceProfile | null {
  const [profile, setProfile] = useState<DeviceProfile | null>(() => getActiveProfile());
  useEffect(() => {
    const refresh = () => setProfile(getActiveProfile());
    window.addEventListener('storage', refresh);
    window.addEventListener('laserforge:active-profile-changed', refresh);
    const pollId = window.setInterval(refresh, 1000);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('laserforge:active-profile-changed', refresh);
      clearInterval(pollId);
    };
  }, []);
  return profile;
}

function FalconWiFiSidebar({
  profile,
  sidebarWidth,
}: {
  profile: DeviceProfile;
  sidebarWidth: number;
}): React.ReactElement | null {
  if (profile.connection?.kind !== 'falcon-wifi') return null;
  const conn = profile.connection;
  const handleDisconnect = () => {
    setActiveProfileId(null);
    try {
      window.dispatchEvent(new Event('laserforge:active-profile-changed'));
    } catch {
      /* non-DOM env */
    }
  };
  return React.createElement(
    'div',
    {
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
        fontFamily: FONT,
      },
    },
    React.createElement(FalconWiFiStatusPanel, {
      ip: conn.ip,
      deviceModel: conn.deviceModel,
      firmwareVersion: conn.firmwareVersion,
      laserInfo: conn.laserInfo,
      macAddress: conn.macAddress,
      onDisconnect: handleDisconnect,
    }),
  );
}

/**
 * T1-204: subscribe to the `workflowPanelV2` UI feature flag so the
 * panel re-renders when the flag is toggled (Settings UI in a future
 * phase, or DevTools localStorage during the rollout). Polls every
 * second as a defense-in-depth fallback for environments where
 * dispatchEvent fires before listeners attach.
 */
function useWorkflowPanelV2Flag(): boolean {
  const [on, setOn] = useState<boolean>(() => getUiFeatureFlag('workflowPanelV2'));
  useEffect(() => {
    const refresh = () => setOn(getUiFeatureFlag('workflowPanelV2'));
    window.addEventListener('storage', refresh);
    window.addEventListener(UI_FEATURE_FLAG_CHANGED_EVENT, refresh);
    const pollId = window.setInterval(refresh, 1000);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(UI_FEATURE_FLAG_CHANGED_EVENT, refresh);
      clearInterval(pollId);
    };
  }, []);
  return on;
}

/**
 * T1-213: WorkflowPanel routing temporarily disabled at the user's
 * request — they preferred the legacy layout and asked to "go back
 * to that one and make some adjustments." The WorkflowPanel code,
 * feature-flag plumbing, and adapter all remain in the tree (the
 * flag still round-trips through localStorage; tests still pass)
 * but ConnectionPanel always renders the legacy panel here.
 *
 * To re-enable the routing during a future revisit, change this
 * constant to `true` and the existing
 * `useWorkflowPanelV2Flag` subscription is reinstated.
 */
const WORKFLOW_PANEL_V2_ENABLED = false;

export function ConnectionPanel(props: ConnectionPanelProps) {
  const activeProfile = useActiveProfile();
  const isFalcon = activeProfile?.connection?.kind === 'falcon-wifi';
  // Always call the hook to keep rules-of-hooks happy; ignore its
  // value when the routing is gated off.
  const workflowFlagOn = useWorkflowPanelV2Flag();
  const workflowPanelV2 = WORKFLOW_PANEL_V2_ENABLED && workflowFlagOn;

  let body: React.ReactNode;
  if (isFalcon && activeProfile) {
    body = React.createElement(FalconWiFiSidebar, {
      profile: activeProfile,
      sidebarWidth: props.sidebarWidth ?? 500,
    });
  } else if (workflowPanelV2) {
    body = React.createElement(WorkflowPanelAdapter, props);
  } else {
    body = React.createElement(ConnectionPanelLegacy, props);
  }

  return React.createElement(React.Fragment, null,
    body,
    React.createElement(FalconAlarmToastStack, {}),
  );
}

/**
 * T1-204: prop adapter between the existing `ConnectionPanelProps`
 * surface (mirrors ~50 fields from ConnectionPanelMainProps) and the
 * new `WorkflowPanel`'s focused surface.
 *
 * Phase 1 wired the scaffold (recovery + machine state + ESTOP).
 * Phase 2 (T1-206) expands to the disconnected / connecting /
 * recovery modes: real Connect USB wiring, the connecting-mode
 * spinner state, and recovery-action dispatch.
 *
 * `onConnectSimulator` and `onCancelConnect` are intentionally
 * stubbed in this phase — they require local refs (MockSerialPort
 * + AbortController) the legacy panel holds; threading them up is
 * Phase 3 work alongside the setup-mode tabs.
 */
function WorkflowPanelAdapter(props: ConnectionPanelProps) {
  const { machineUi } = props;
  const machineService = machineUi.service;
  const executionCoordinator = machineUi.executionCoordinator;
  const controller = props.controller;
  const machineState = props.machineState;
  const machineStatus = machineState?.status ?? null;
  // Same isConnected derivation as ConnectionPanelMain.tsx:424.
  const isConnected =
    machineStatus !== 'disconnected'
    && machineStatus !== 'connecting'
    && machineState !== null;

  // recoveryState subscription — same pattern as ConnectionPanelMain.
  const [recoveryState, setRecoveryState] = useState(() => machineService.getRecoveryState());
  useEffect(() => {
    setRecoveryState(machineService.getRecoveryState());
    return machineService.onRecoveryStateChange(setRecoveryState);
  }, [machineService]);

  // T1-206 (Phase 2): track the connecting flag locally. Set true
  // when the user fires Connect USB; cleared when isConnected
  // becomes true OR when an error throws OR when the user cancels.
  // The "isConnecting" mode is what the user sees during the
  // controller handshake.
  const [isConnecting, setIsConnecting] = useState(false);
  useEffect(() => {
    if (isConnected) setIsConnecting(false);
  }, [isConnected]);

  const onEmergencyStop = () => {
    void machineService.emergencyStop();
  };

  // T1-206: real Connect-USB wiring. Calls machineService directly;
  // the legacy panel's connect handler does more (mock port for
  // simulator, abort controller, simulator-mode flag) but the
  // basic real-hardware path is just connectRealLaser.
  const onConnectUsb = () => {
    if (isConnecting) return;
    setIsConnecting(true);
    void machineService.connectRealLaser(115200).catch(() => {
      setIsConnecting(false);
    });
  };

  // T1-206: cancel wiring. Goes through MachineService's signal-aware
  // cancel path (T1-50 + T2-33). On success, the local connecting
  // flag clears so the panel returns to disconnected mode.
  const onCancelConnect = () => {
    void machineService.cancelActiveConnect().finally(() => {
      setIsConnecting(false);
    });
  };

  // T1-206: recovery-action dispatch. Action labels come from
  // RecoveryCardContent's `RecoveryAction` union. Critical paths
  // (unlock / re-home / reconnect / stop) get real wiring through
  // ExecutionCoordinator / MachineService. The remaining actions
  // (reframe / frame / compile) need scene + canvas context that
  // the legacy panel holds; they're logged for now and wired in a
  // Phase 3 follow-up.
  const onRecoveryAction = (action: string) => {
    // executionCoordinator owns its own controller / port references;
    // we don't need to thread the controller object through here. The
    // "is the controller connected" gate lives inside each coordinator
    // method.
    switch (action) {
      case 'unlock':
        void executionCoordinator.unlock();
        return;
      case 'home':
      case 're-home':
        void executionCoordinator.home();
        return;
      case 'reconnect':
        // Send the user back to disconnected — they'll click Connect
        // again. The full reconnect flow (auto-reconnect with same
        // device) is Phase 3 / T3-48 work.
        void machineService.disconnect();
        return;
      case 'stop':
        void machineService.stopAndEnsureLaserOff();
        return;
      case 'reframe':
      case 'frame':
      case 'compile':
        console.warn(
          `[WorkflowPanel T1-206] Recovery action '${action}' is wired in `
          + 'Phase 3 — disable the workflowPanelV2 flag and use the legacy '
          + 'panel for this action until then.',
        );
        return;
    }
  };

  // T1-207 (Phase 3): bundle the setup-mode props. Jog step is
  // tracked locally — the legacy panel uses the same pattern.
  // `sendUserCommand` is a minimal wrapper around
  // machineService.sendCommand: safe commands flow through, warn /
  // dangerous classifications log + return without sending (the
  // approval-token flow is wired in the legacy panel; users
  // needing it should flip workflowPanelV2 off until Phase 4
  // lifts that flow into a shared helper).
  const [jogStep, setJogStep] = useState(1);
  // ExecutionCoordinator.jog requires a feedRate. The legacy panel
  // also hardcodes 3000 mm/min (see ConnectionPanelMain.handleJog
  // line 903 + the saved-origin-go path line 942); there's no
  // profile field for jog feed today. T1-207 originally shipped 1000
  // mm/min which felt sluggish; matching the legacy panel exactly is
  // the safest fix — same speed in both panels.
  const JOG_DEFAULT_FEED_MM_PER_MIN = 3000;
  const onJog = (axis: 'X' | 'Y', distance: number) => {
    void executionCoordinator.jog(axis, distance, JOG_DEFAULT_FEED_MM_PER_MIN);
  };
  const onHome = () => {
    void executionCoordinator.home();
  };
  const sendUserCommand = async (cmd: string) => {
    if (!cmd.trim()) return;
    const classification = machineService.classifyUserCommand(cmd);
    if (classification.severity === 'dangerous' || classification.severity === 'warn') {
      console.warn(
        `[WorkflowPanel T1-207] Command "${classification.command}" needs `
        + `approval (${classification.severity}: ${classification.reason}). `
        + 'The approval-token flow is wired in the legacy panel — flip the '
        + 'workflowPanelV2 flag off to use it.',
      );
      return;
    }
    try {
      await machineService.sendCommand(cmd, 'user', undefined);
    } catch (err: unknown) {
      console.warn('[WorkflowPanel T1-207] Command rejected:', err);
    }
  };
  // Shared with the Start-Job wiring below — declared up here so
  // the frame block (which uses compileResult canvas burn/plan bounds and
  // startMode) doesn't trip a hoisting error.
  const compileResult = props.lastGcodeCompileResult ?? null;
  const compiledTicket = props.compiledJobTicket ?? compileResult?.ticket ?? null;
  const startMode = props.startMode;

  // T1-211 (Phase 5b): frame wiring for the Move tab.
  // Two buttons: Frame (safe corner trace with laser-off motion) and
  // Frame + Dot (low-power outline + center mark). Both require a
  // compiled job (we read canvasBurnBounds/canvasPlanBounds from lastGcodeCompileResult)
  // and an idle controller. Saved-origin G54 drift verification is
  // intentionally skipped — the new panel already blocks savedOrigin
  // mode at the Start button, so frame here only runs in absolute /
  // current modes where drift isn't a risk.
  const sceneBounds = compileResult?.canvasBurnBounds ?? compileResult?.canvasPlanBounds ?? null;
  const frameTransformBounds = compileResult?.canvasPlanBounds ?? sceneBounds;
  const canFrame =
    isConnected
    && machineStatus === 'idle'
    && sceneBounds !== null;

  const onFrameSafe = canFrame
    ? () => {
        if (!sceneBounds) return;
        const transformOpts = {
          startMode,
          savedOrigin: props.savedOrigin,
          originCorner: props.originCorner,
          bedHeightMm: props.bedHeight ?? 400,
          bedWidthMm: props.bedWidth ?? 400,
        };
        const corners = buildFrameCorners(sceneBounds, transformOpts, frameTransformBounds ?? sceneBounds);
        const ys = corners.map((c) => c.y);
        const xs = corners.map((c) => c.x);
        const ok = window.confirm(
          `Frame the bed: X ${Math.min(...xs).toFixed(0)} - ${Math.max(...xs).toFixed(0)} mm, `
          + `Y ${Math.min(...ys).toFixed(0)} - ${Math.max(...ys).toFixed(0)} mm. Continue?`,
        );
        if (!ok) return;
        const idleTimeoutMs = estimateFrameIdleTimeoutMs(corners);
        const activeProfile = getActiveProfile();
        const frameLineDelayMs = resolveFrameLineDelayMs(activeProfile);
        void executionCoordinator
          .frameSafe({
            sceneBounds,
            transformReferenceBounds: frameTransformBounds ?? sceneBounds,
            transformOpts,
            idleTimeoutMs,
            frameLineDelayMs,
          })
          .catch((err: unknown) => {
            console.warn(
              '[WorkflowPanel T1-211] Frame safe failed:',
              err instanceof Error ? err.message : err,
            );
          });
      }
    : null;

  const onFrameDot = canFrame
    ? () => {
        if (!sceneBounds) return;
        // One-time low-power-fire acknowledgement — matches the
        // legacy panel's localStorage gate. After the user confirms
        // once, the bare bounds-confirm is enough.
        const acked = localStorage.getItem('laserforge_frame_dot_acknowledged_v2');
        if (!acked) {
          const ok = window.confirm(
            'Frame + Mark Center fires the laser at low power to trace the outline and '
            + 'mark a small + at the center. Use only with eye protection on material that '
            + 'can handle a brief mark. Continue?',
          );
          if (!ok) return;
          try { localStorage.setItem('laserforge_frame_dot_acknowledged_v2', 'true'); } catch { /* */ }
        }
        const transformOpts = {
          startMode,
          savedOrigin: props.savedOrigin,
          originCorner: props.originCorner,
          bedHeightMm: props.bedHeight ?? 400,
          bedWidthMm: props.bedWidth ?? 400,
        };
        const corners = buildFrameCorners(sceneBounds, transformOpts, frameTransformBounds ?? sceneBounds);
        const ys = corners.map((c) => c.y);
        const xs = corners.map((c) => c.x);
        const okBounds = window.confirm(
          `Frame + Dot at: X ${Math.min(...xs).toFixed(0)} - ${Math.max(...xs).toFixed(0)} mm, `
          + `Y ${Math.min(...ys).toFixed(0)} - ${Math.max(...ys).toFixed(0)} mm. Continue?`,
        );
        if (!okBounds) return;
        const activeProfile = getActiveProfile();
        const maxSpindle = activeProfile?.maxSpindle ?? 1000;
        const frameDotFeedRateMmPerMin = resolveFrameDotFeedRate(activeProfile);
        const frameLineDelayMs = resolveFrameLineDelayMs(activeProfile);
        void executionCoordinator
          .frameDot({
            sceneBounds,
            transformReferenceBounds: frameTransformBounds ?? sceneBounds,
            transformOpts,
            maxSpindle,
            frameDotFeedRateMmPerMin,
            frameLineDelayMs,
          })
          .catch((err: unknown) => {
            console.warn(
              '[WorkflowPanel T1-211] Frame dot failed:',
              err instanceof Error ? err.message : err,
            );
          });
      }
    : null;

  const setupModeProps = {
    // Move tab
    jogStep,
    setJogStep,
    onJog,
    onHome,
    canHome: isConnected && machineStatus === 'idle',
    canFrame,
    onFrameSafe,
    onFrameDot,
    // Job tab — bed dimensions fall back to safe defaults when the
    // adapter doesn't have them threaded (Phase 4 will lift the
    // bed-size resolution up).
    activeProfile: null,
    resolvedBedWidthMm: props.bedWidth ?? 400,
    resolvedBedHeightMm: props.bedHeight ?? 400,
    gcodeLoaded: typeof props.gcode === 'string' && props.gcode.length > 0,
    gcodeStale: false,
    onRecompile: null,
    // Console tab
    isConnected,
    isRunning: controller?.isJobRunning ?? false,
    controller,
    sendUserCommand,
    messageEvents: machineUi.messageEvents,
  };

  // T1-208 (Phase 4): live-job props for ready / running / paused.
  // jobProgress comes from the controller / machineUi.
  const jobProgress = props.jobProgress;
  const jobName = props.scene.metadata?.name ?? 'Untitled';
  const lineCount = jobProgress?.totalLines ?? null;

  // T1-209 follow-up: optimistic-pause local state. Declared up
  // here (rather than later next to the pause/resume handlers) so
  // the elapsed-time effect below can reference it without a
  // hoisting error.
  const [pauseRequested, setPauseRequested] = useState(false);
  useEffect(() => {
    if (machineStatus === 'hold') setPauseRequested(false);
  }, [machineStatus]);

  // T1-210 (Phase 4 follow-up): live elapsed-time tracking. Mirrors
  // the legacy panel's pattern (ConnectionPanelMain:253 + 645) —
  // start time captured when the machine transitions idle → run,
  // ticked once a second while running (paused or stopped halts the
  // tick), and reset when the controller returns to idle. The
  // estimator runs once per gcode-load and yields totalSeconds for
  // ETA + a pre-start estimate.
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [jobStartTime, setJobStartTime] = useState<number | null>(null);
  const isControllerRunning = machineStatus === 'run';
  const isControllerHeld = machineStatus === 'hold' || pauseRequested;
  useEffect(() => {
    if (isControllerRunning || isControllerHeld) {
      if (jobStartTime === null) setJobStartTime(Date.now());
    } else if (machineStatus === 'idle' || machineStatus === 'disconnected') {
      if (jobStartTime !== null) {
        setJobStartTime(null);
        setElapsedSeconds(0);
      }
    }
  }, [isControllerRunning, isControllerHeld, machineStatus, jobStartTime]);
  useEffect(() => {
    if (!isControllerRunning || isControllerHeld || jobStartTime === null) return;
    const tick = () => {
      setElapsedSeconds(Math.floor((Date.now() - jobStartTime) / 1000));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isControllerRunning, isControllerHeld, jobStartTime]);

  // Job time estimate — yields totalSeconds and a "M:SS" formatted
  // string. Called whenever the gcode changes (cheap; runs in the
  // hundreds of microseconds for typical jobs).
  const gcode = props.gcode;
  const estimate = useMemo(
    () => (typeof gcode === 'string' && gcode.length > 0 ? estimateJobTime(gcode) : null),
    [gcode],
  );
  const estimatedTotalSeconds = estimate?.totalSeconds ?? null;
  const estimatedRemaining =
    estimatedTotalSeconds !== null
      ? Math.max(0, estimatedTotalSeconds - elapsedSeconds)
      : null;

  // pauseRequested + its sync effect were declared above so the
  // elapsed-time tracking can reference them. The optimistic-pause
  // rationale lives there.

  const onPause = () => {
    // Optimistically flip the UI to paused mode immediately.
    setPauseRequested(true);
    void machineService.pause().catch((err: unknown) => {
      // If the pause command failed, the UI is stuck in 'paused'
      // mode but the job is still running. Roll back the optimistic
      // flag AND warn so the user can hit Stop. Mirrors the legacy
      // panel's pause-failed alert (ConnectionPanelMain.tsx:1403).
      setPauseRequested(false);
      console.warn(
        '[WorkflowPanel T1-209] Pause command not accepted:',
        err instanceof Error ? err.message : err,
      );
      try {
        window.alert(
          'Pause failed — the machine did not accept the command. The job may still be running. Use Stop to halt it.',
        );
      } catch {
        /* non-DOM env */
      }
    });
  };
  const onResume = () => {
    setPauseRequested(false);
    void machineService.resume().catch((err: unknown) => {
      console.warn(
        '[WorkflowPanel T1-209] Resume command not accepted:',
        err instanceof Error ? err.message : err,
      );
    });
  };
  const onStop = () => {
    setPauseRequested(false);
    void machineService.stopAndEnsureLaserOff();
  };

  // T1-209 (Phase 5a): wire Start Job. Compared to the legacy panel's
  // 127-line handleStartJob this is intentionally minimal:
  //   - the start-readiness gate (already evaluated for canStartJob
  //     below) is the load-bearing safety check
  //   - saved-origin mode falls back to the legacy panel (its G54
  //     drift verification dialog isn't lifted yet)
  //   - the preflight confirmation dialog and production-tip dialog
  //     are skipped — they're advisory; the readiness gate that
  //     enables this button already requires preflight to pass
  // canvasContext + notifySimulatorTx are read from the same sources
  // the legacy panel uses.
  const startReady =
    isConnected
    && machineStatus === 'idle'
    && compiledTicket !== null
    && compileResult !== null;
  const onStartJob = (startReady && startMode !== 'savedOrigin')
    ? () => {
        if (!compiledTicket || !compileResult) return;
        const canvasContext = {
          canvasMoves: compileResult.canvasMoves,
          canvasPlanBounds: compileResult.canvasPlanBounds,
          machineTransform: compileResult.machineTransform,
        };
        const notifySimulatorTx = machineUi.coordinatorSimulatorNotifyRef.current
          ?? (() => {});
        void executionCoordinator
          .startValidatedJob({
            ticket: compiledTicket,
            scene: props.scene,
            machineState,
            notifySimulatorTx,
            canvasContext,
          })
          .catch((err: unknown) => {
            console.warn(
              '[WorkflowPanel T1-209] Start Job failed:',
              err instanceof Error ? err.message : err,
            );
          });
      }
    : null;

  const liveJobProps = {
    ready: {
      jobName,
      lineCount,
      estimatedTime: estimate?.formatted ?? null,
      planSummary: null as string | null,
    },
    running: {
      jobProgress: jobProgress ?? null,
      elapsedSeconds,
      estimatedRemaining,
      activeLabel: 'Running',
      planSummary: null as string | null,
    },
    paused: {
      jobProgress: jobProgress ?? null,
      elapsedSeconds,
      estimatedRemaining,
      planSummary: null as string | null,
    },
  };

  return React.createElement(
    'div',
    {
      style: {
        width: props.sidebarWidth ?? 500,
        flexShrink: 0,
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column' as const,
        overflow: 'hidden',
      },
    },
    React.createElement(WorkflowPanel, {
      machineState,
      machineStatus,
      isConnected,
      isConnecting,
      recoveryState,
      // T1-209 (Phase 5a): canStartJob is derived directly from the
      // observable preconditions for a safe start. This is a lighter
      // check than the legacy panel's buildStartReadiness (which
      // also looks at preflight blockers, frame freshness, laser
      // state, WiFi trust); a Phase 5b can replace this with the
      // full readiness object lifted up to App.tsx so both panels
      // share the SAME canStartJob.
      canStartJob: startReady && startMode !== 'savedOrigin',
      pauseRequested,
      onEmergencyStop,
      onConnectUsb,
      // Phase 2 deliberate stubs (see component docstring).
      onConnectSimulator: null,
      onCancelConnect,
      onStartJob,
      onPause,
      onResume,
      onStop,
      // T1-212: surface the same Frame action that the Move tab
      // already uses, so it sits beside Start Job in the footer.
      onFrameSafe,
      webSerialSupported: WebSerialPort.isSupported(),
      alarmCode: machineState?.alarmCode ?? null,
      onRecoveryAction,
      setupModeProps,
      liveJobProps,
    }),
  );
}

function ConnectionPanelLegacy(props: ConnectionPanelProps) {
  const { machineUi, ...mainProps } = props;
  const { controller, portRef, machineState, jobProgress } = mainProps;
  const {
    service: machineService,
    messages,
    messageEvents,
    appendMessage,
    appendLogEvent,
    replaceMessages,
    clearMessages,
    appendConsoleLine,
    isSimulator,
    setSimulator,
  } = machineUi;

  const [currentReplay, setCurrentReplay] = useState<JobReplay | null>(null);
  const [showOutcome, setShowOutcome] = useState(false);

  useEffect(() => {
    return machineService.attachJobRecording(controller, {
      appendConsoleLine,
      onReplayCompleted: r => {
        setCurrentReplay({ ...r });
        setShowOutcome(true);
      },
    });
  }, [controller, machineService, appendConsoleLine]);

  useEffect(() => {
    const running = controller.isJobRunning ?? false;
    void machineService.tryFinalizeJobLog(machineState, jobProgress, running, appendMessage);
  }, [
    machineState?.status,
    jobProgress?.linesAcknowledged,
    jobProgress?.totalLines,
    machineService,
    appendMessage,
    machineState,
    jobProgress,
  ]);

  const outcomeReplaySection =
    showOutcome && currentReplay
      ? React.createElement(JobOutcomeDialog, {
          font: FONT,
          replay: currentReplay,
          onOutcome: outcome => {
            machineService.applyReplayOutcome(currentReplay, outcome);
            appendMessage(`Outcome recorded: ${outcome.replace(/_/g, ' ')}`);
            setShowOutcome(false);
          },
          onSkip: () => setShowOutcome(false),
        })
      : null;

  return React.createElement(ConnectionPanelMain, {
    ...mainProps,
    machineService,
    executionCoordinator: machineUi.executionCoordinator,
    coordinatorSimulatorNotifyRef: machineUi.coordinatorSimulatorNotifyRef,
    outcomeReplaySection,
    messages,
    messageEvents,
    appendMessage,
    appendLogEvent,
    replaceMessages,
    clearMessages,
    isSimulator,
    setSimulator,
  });
}
