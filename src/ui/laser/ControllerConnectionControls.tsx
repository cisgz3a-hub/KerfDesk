import { useState } from 'react';
import type { MachineKind } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { machineNoun } from '../machine/machine-labels';
import { MachineModeToggle } from '../machine/MachineModeToggle';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import { useLaserStore } from '../state/laser-store';
import { loadAutoConnectPreference, saveAutoConnectPreference } from '../state/serial-port-memory';
import { ConnectionBar } from './ConnectionBar';
import { connectMachine } from './connect-machine';
import {
  isFileOnlyController,
  useControllerQualificationRetry,
  useControllerReconnect,
} from './controller-reconnect';
import { ConnectedMachineProfile } from './ConnectedMachineProfile';
import { LaserModuleRow } from './LaserModuleRow';
import { DeviceSetupControls } from './device-setup';
import { controllerActionFailureHandler } from './report-controller-action-failure';
import { MachineNetworkConnect } from './MachineNetworkConnect';
import { useControllerWentSilent } from './use-controller-went-silent';
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
  const wentSilent = useControllerWentSilent(connection.kind === 'connected');
  const disconnectController = useLaserStore((state) => state.disconnect);
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const machineName = useStore((state) => state.project.device.name || 'Unnamed machine');
  const supportsSerial = platform.serial.isSupported();
  const isFileOnlyProfile = isFileOnlyController(controllerKind);
  const connect = (): void => {
    void connectMachine(platform).catch(controllerActionFailureHandler('Connect'));
  };
  const reconnect = useControllerReconnect();
  const retryControllerInformation = useControllerQualificationRetry();
  // A connected machine is closed first, so the chosen port replaces it.
  const choosePort = async (): Promise<void> => {
    if (useLaserStore.getState().connection.kind === 'connected') await disconnectController();
    await connectMachine(platform, { portSelection: 'choose' });
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
        autoConnect={autoConnect.enabled}
        onAutoConnectChange={autoConnect.change}
        portChoiceEndsOnRestart={platform.serial.picksEndOnRestart === true}
        portMemoryNeedsSerialNumber={isApplePlatform() || isLinuxDesktop()}
        connection={connection}
        machineNoun={machineNoun(props.machineKind)}
        onConnect={connect}
        onDisconnect={() =>
          void disconnectController().catch(controllerActionFailureHandler('Disconnect'))
        }
        onForget={props.onForget}
        qualification={qualification}
        qualificationReadBlockReason={qualificationReadBlockReason}
        reconnectRecommended={reconnectRecommended}
        controllerWentSilent={wentSilent}
        onRetryQualification={retryControllerInformation}
        onReconnectQualification={reconnect}
        disabled={
          !supportsSerial ||
          connectionControlsBusy(props.motionOperation, props.controllerOperation) ||
          isFileOnlyProfile
        }
      />
    </>
  );
}

function MachineDetailsContent(): JSX.Element {
  return (
    <>
      <LaserModuleRow />
      <MachineNetworkConnect />
    </>
  );
}

function useAutoConnectPreference(): {
  readonly enabled: boolean;
  readonly change: (enabled: boolean) => void;
} {
  const [enabled, setEnabled] = useState(() => loadAutoConnectPreference(browserLocalStorage()));
  const change = (next: boolean): void => {
    saveAutoConnectPreference(browserLocalStorage(), next);
    setEnabled(next);
  };
  return { enabled, change };
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

// Connection management is the escape hatch for a stale reset or startup
// handshake. Keep Disconnect/Reconnect available for those controller-owned
// operations while motion and autofocus retain their stricter lockout.
export function connectionControlsBusy(
  motionOperation: unknown,
  controllerOperation: ReturnType<typeof useLaserStore.getState>['controllerOperation'],
): boolean {
  if (motionOperation !== null) return true;
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
