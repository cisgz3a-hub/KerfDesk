import React, { useEffect, useState } from 'react';
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

export function ConnectionPanel(props: ConnectionPanelProps) {
  const activeProfile = useActiveProfile();
  const isFalcon = activeProfile?.connection?.kind === 'falcon-wifi';
  const workflowPanelV2 = useWorkflowPanelV2Flag();

  // T1-204: Falcon WiFi sidebar takes precedence over both panel
  // shapes. When the WorkflowPanelV2 flag is on AND we're not in
  // Falcon mode, route to the new panel; otherwise fall through to
  // the existing ConnectionPanelLegacy.
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
  // ExecutionCoordinator.jog requires a feedRate; use a conservative
  // 1000 mm/min default — the legacy panel resolves from the active
  // profile, but Phase 3 ships a literal default to avoid threading
  // profile state through. Phase 4 will lift the profile-aware feed
  // resolution up.
  const JOG_DEFAULT_FEED_MM_PER_MIN = 1000;
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
  const setupModeProps = {
    // Move tab
    jogStep,
    setJogStep,
    onJog,
    onHome,
    canHome: isConnected && machineStatus === 'idle',
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
  // jobProgress comes from the controller / machineUi; elapsedSeconds
  // is tracked locally (set when a job starts, cleared when it ends).
  // For Phase 4 the start callback is intentionally null — the legacy
  // panel owns the full ticket-validation flow (compile + hash + scene
  // verification) that's not yet lifted up. Pause / Resume / Stop are
  // safe to wire because they're idempotent commands the user invokes
  // on an already-running job.
  const jobProgress = props.jobProgress;
  const jobName = props.scene.metadata?.name ?? 'Untitled';
  const lineCount = jobProgress?.totalLines ?? null;

  const onPause = () => {
    void machineService.pause();
  };
  const onResume = () => {
    void machineService.resume();
  };
  const onStop = () => {
    void machineService.stopAndEnsureLaserOff();
  };

  const liveJobProps = {
    ready: {
      jobName,
      lineCount,
      estimatedTime: null as string | null,
      planSummary: null as string | null,
    },
    running: {
      jobProgress: jobProgress ?? null,
      elapsedSeconds: 0,
      estimatedRemaining: null as number | null,
      activeLabel: 'Running',
      planSummary: null as string | null,
    },
    paused: {
      jobProgress: jobProgress ?? null,
      elapsedSeconds: 0,
      estimatedRemaining: null as number | null,
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
      // Phase 1 stub: canStartJob is computed inside ConnectionPanelMain
      // via buildStartReadiness; Phase 5 lifts that computation up so
      // both panels can share it.
      canStartJob: false,
      onEmergencyStop,
      onConnectUsb,
      // Phase 2 deliberate stubs (see component docstring).
      onConnectSimulator: null,
      onCancelConnect,
      // T1-208 (Phase 4): Start stays null (legacy panel owns the
      // full ticket-validation flow); pause/resume/stop are wired
      // because they're safe idempotent commands.
      onStartJob: null,
      onPause,
      onResume,
      onStop,
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
