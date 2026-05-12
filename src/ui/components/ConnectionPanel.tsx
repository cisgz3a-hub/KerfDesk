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
 * new `WorkflowPanel`'s focused surface. Phase 1 wires only what the
 * scaffold uses — recovery / machine state / connection booleans +
 * a handful of action callbacks. Phase 2 expands this to thread the
 * full set as each mode's real implementation lands.
 */
function WorkflowPanelAdapter(props: ConnectionPanelProps) {
  const { machineUi } = props;
  const machineService = machineUi.service;
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

  // Phase 1: keep handler wiring minimal. Real connect / disconnect /
  // job-control wiring lives in Phase 2+ when each mode's real
  // implementation lands. For now the footer renders disabled
  // placeholders for safety paths.
  const onEmergencyStop = () => {
    void machineService.emergencyStop();
  };

  // T1-204 follow-up: WorkflowPanel uses width:100% so it inherits
  // whatever the parent flex slot gives it. The Falcon sidebar
  // pattern (above) wraps in a fixed-width div with flexShrink:0 so
  // the canvas keeps its space. The new panel needs the same wrap;
  // without it the panel takes unbounded width and the canvas is
  // squeezed out.
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
      // Phase 1 stub: connecting is detectable today only via app-level
      // state (active connect promise); Phase 2 threads it through.
      isConnecting: false,
      recoveryState,
      // Phase 1 stub: canStartJob is computed inside ConnectionPanelMain
      // via buildStartReadiness; Phase 2 lifts that computation up so
      // both panels can share it.
      canStartJob: false,
      onEmergencyStop,
      onConnectUsb: null,
      onConnectSimulator: null,
      onCancelConnect: null,
      onStartJob: null,
      onPause: null,
      onResume: null,
      onStop: null,
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
