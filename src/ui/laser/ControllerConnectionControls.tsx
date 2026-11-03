import { useState } from 'react';
import type { MachineKind } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { machineNoun } from '../machine/machine-labels';
import { MachineModeToggle } from '../machine/MachineModeToggle';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import { useLaserStore } from '../state/laser-store';
import { motionOwnerAwaitsMissingReply } from '../state/laser-motion-release';
import { loadAutoConnectPreference, saveAutoConnectPreference } from '../state/serial-port-memory';
import { pauseAutoConnect, useAutoConnectSession } from '../state/auto-connect-session';
import { ConnectionBar, type ConnectionBarProps } from './ConnectionBar';
import { connectMachine } from './connect-machine';
import {
  isFileOnlyController,
  useControllerQualificationRetry,
  useControllerReconnect,
} from './controller-reconnect';
import { ConnectedMachineProfile } from './ConnectedMachineProfile';
import { connectOptionsForDevice } from '../commands/connect-options';
import {
  liveDriverMismatch,
  toolbarDriverMismatchText,
  toolbarMachineName,
} from './live-driver-mismatch';
import { LaserModuleRow } from './LaserModuleRow';
import { DeviceSetupControls } from './device-setup';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import { MachineNetworkConnect } from './MachineNetworkConnect';
import {
  useControllerStoppedResponding,
  useControllerWentSilent,
} from './use-controller-went-silent';
import { isApplePlatform, isLinuxDesktop } from '../common/operating-system';

type Props = {
  readonly machineKind: MachineKind;
  readonly autofocusBusy: boolean;
  readonly motionOperation: ReturnType<typeof useLaserStore.getState>['motionOperation'];
  readonly controllerOperation: ReturnType<typeof useLaserStore.getState>['controllerOperation'];
  readonly onForget: () => void;
};

export function ControllerConnectionControls(props: Props): JSX.Element {
  const platform = usePlatform();
  const connection = useLaserStore((state) => state.connection);
  const qualification = useLaserStore((state) => state.controllerQualification);
  const qualificationReadBlockReason = useLaserStore((state) =>
    state.getMachineSettingsReadBlockReason(),
  );
  const reconnectRecommended = useLaserStore((state) => state.getControllerReconnectRecommended());
  const controlsBusy = useConnectionControlsBusy(props);
  const wentSilent = useControllerWentSilent(connection.kind === 'connected');
  const stoppedResponding = useControllerStoppedResponding(connection.kind === 'connected');
  const disconnectController = useLaserStore((state) => state.disconnect);
  const connectController = useLaserStore((state) => state.connect);
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const device = useStore((state) => state.project.device);
  const driverMismatch = useLiveDriverMismatch(device);
  const machineName = toolbarMachineName(device.name || 'Unnamed machine', driverMismatch);
  const supportsSerial = platform.serial.isSupported();
  const isFileOnlyProfile = isFileOnlyController(controllerKind);
  const connect = (): void => {
    void connectMachine(platform).catch(controllerActionFailureHandler('Connect'));
  };
  const reconnect = useControllerReconnect();
  const retryControllerInformation = useControllerQualificationRetry();
  // The operator's Disconnect pauses auto-connect until a port they choose
  // opens (ADR-639); the store's own disconnect, used by the baud scan, does not.
  const disconnect = async (): Promise<void> => {
    pauseAutoConnect();
    await disconnectController();
  };
  // A connected machine is closed first, so the chosen port replaces it. A
  // cancelled picker then leaves it disconnected and auto-connect paused.
  const choosePort = async (): Promise<void> => {
    if (useLaserStore.getState().connection.kind === 'connected') await disconnect();
    await connectMachine(platform, { portSelection: 'choose' });
  };
  // The saved profile's driver replaces the live one: the same reconnect as
  // Machine Setup's, offered when its Save could not switch it (U2-P2-1).
  const reconnectWithProfile = async (): Promise<void> => {
    await disconnectController();
    await connectController(platform, connectOptionsForDevice(useStore.getState().project.device));
  };
  const autoConnect = useAutoConnectPreference();
  return (
    <>
      {/* The safety notice floats over the canvas instead (ADR-634). */}
      <ConnectionHints supportsSerial={supportsSerial} isFileOnlyProfile={isFileOnlyProfile} />
      <ConnectionBar
        machineName={machineName}
        mode={<MachineModeToggle />}
        machine={<ConnectedMachineProfile />}
        details={<MachineDetailsContent />}
        setup={<DeviceSetupControls />}
        onChoosePort={() => void choosePort().catch(controllerActionFailureHandler('Connect'))}
        {...autoConnect}
        portChoiceEndsOnRestart={platform.serial.picksEndOnRestart === true}
        portMemoryNeedsSerialNumber={isApplePlatform() || isLinuxDesktop()}
        connection={connection}
        machineNoun={machineNoun(props.machineKind)}
        onConnect={connect}
        onDisconnect={() => void disconnect().catch(controllerActionFailureHandler('Disconnect'))}
        onForget={props.onForget}
        qualification={qualification}
        qualificationReadBlockReason={qualificationReadBlockReason}
        reconnectRecommended={reconnectRecommended}
        controllerWentSilent={wentSilent}
        controllerStoppedResponding={stoppedResponding}
        onRetryQualification={retryControllerInformation}
        onReconnectQualification={reconnect}
        driverMismatch={
          driverMismatch === null
            ? undefined
            : {
                text: toolbarDriverMismatchText(driverMismatch),
                onReconnect: () =>
                  void reconnectWithProfile().catch(controllerActionFailureHandler('Reconnect')),
              }
        }
        disabled={!supportsSerial || controlsBusy || isFileOnlyProfile}
      />
    </>
  );
}

function useLiveDriverMismatch(device: ReturnType<typeof useStore.getState>['project']['device']) {
  const connected = useLaserStore((state) => state.connection.kind === 'connected');
  const activeControllerKind = useLaserStore((state) => state.activeControllerKind);
  const activeControllerCommandSet = useLaserStore((state) => state.activeControllerCommandSet);
  return liveDriverMismatch(device, {
    connected,
    activeControllerKind,
    activeControllerCommandSet,
  });
}

function MachineDetailsContent(): JSX.Element {
  return (
    <>
      <LaserModuleRow />
      <MachineNetworkConnect />
    </>
  );
}

// The saved preference, plus this run's pause and skipped hint (ADR-639).
function useAutoConnectPreference(): Pick<
  ConnectionBarProps,
  'autoConnect' | 'onAutoConnectChange' | 'autoConnectPaused' | 'autoConnectSkipped'
> {
  const [enabled, setEnabled] = useState(() => loadAutoConnectPreference(browserLocalStorage()));
  const session = useAutoConnectSession();
  const change = (next: boolean): void => {
    saveAutoConnectPreference(undefined, next);
    setEnabled(next);
  };
  return {
    autoConnect: enabled,
    onAutoConnectChange: change,
    autoConnectPaused: session.paused,
    autoConnectSkipped: session.skippedReason,
  };
}

function ConnectionHints(props: {
  readonly supportsSerial: boolean;
  readonly isFileOnlyProfile: boolean;
}): JSX.Element | null {
  if (props.isFileOnlyProfile) {
    return (
      <p className="lf-connection-hint" style={hintStyle}>
        This profile is file-export only: use Save G-code… to write an experimental .rd job and run
        it from the machine panel. Live Ruida streaming is not available in this build.
      </p>
    );
  }
  if (!props.supportsSerial) {
    return (
      <p className="lf-connection-hint" style={hintStyle}>
        Your browser doesn&apos;t support WebSerial. Use Chrome, Edge, Brave (may require enabling
        under Brave Shields/flags), or Arc, or install the Windows desktop app.
      </p>
    );
  }
  return null;
}

// A motion owner locks the connection controls, except one that only a
// missing reply holds on an Idle machine (ADR-640).
function useConnectionControlsBusy(props: Props): boolean {
  const missingReply = useLaserStore(motionOwnerAwaitsMissingReply);
  return connectionControlsBusy(props.motionOperation, props.controllerOperation, missingReply);
}

// Connection management is the escape hatch for a stale reset or startup
// handshake. Keep Disconnect/Reconnect available for those controller-owned
// operations while motion and autofocus retain their stricter lockout. A motion
// owner that only a missing reply holds on an Idle machine is the exception:
// a new session is the only way to clear it (ADR-640).
export function connectionControlsBusy(
  motionOperation: unknown,
  controllerOperation: ReturnType<typeof useLaserStore.getState>['controllerOperation'],
  motionAwaitsMissingReply = false,
): boolean {
  if (motionOperation !== null && !motionAwaitsMissingReply) return true;
  return (
    controllerOperation !== null &&
    controllerOperation.kind !== 'autofocus' &&
    controllerOperation.kind !== 'recovery' &&
    controllerOperation.kind !== 'connection-handshake'
  );
}

const hintStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontStyle: 'italic',
  margin: 0,
};
