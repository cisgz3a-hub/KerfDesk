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

export type ConnectionPanelProps = Omit<
  ConnectionPanelMainProps,
  | 'machineService'
  | 'outcomeReplaySection'
  | 'messages'
  | 'appendMessage'
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

export function ConnectionPanel(props: ConnectionPanelProps) {
  const activeProfile = useActiveProfile();
  const isFalcon = activeProfile?.connection?.kind === 'falcon-wifi';

  const body = isFalcon && activeProfile
    ? React.createElement(FalconWiFiSidebar, {
        profile: activeProfile,
        sidebarWidth: props.sidebarWidth ?? 500,
      })
    : React.createElement(ConnectionPanelLegacy, props);

  return React.createElement(React.Fragment, null,
    body,
    React.createElement(FalconAlarmToastStack, {}),
  );
}

function ConnectionPanelLegacy(props: ConnectionPanelProps) {
  const { machineUi, ...mainProps } = props;
  const { controller, portRef, machineState, jobProgress } = mainProps;
  const {
    service: machineService,
    messages,
    appendMessage,
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
    machineService.tryFinalizeJobLog(machineState, jobProgress, running, appendMessage);
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
    outcomeReplaySection,
    messages,
    appendMessage,
    replaceMessages,
    clearMessages,
    isSimulator,
    setSimulator,
  });
}
