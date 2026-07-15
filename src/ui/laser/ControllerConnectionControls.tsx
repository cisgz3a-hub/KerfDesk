import { selectControllerDriver } from '../../core/controllers';
import type { MachineKind } from '../../core/scene';
import { usePlatform } from '../app/platform-context';
import { machineNoun } from '../machine/machine-labels';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { ConnectionBar } from './ConnectionBar';
import { DeviceSetupControls, type DeviceSetupOpenRequest } from './device-setup';
import { SafetyNoticeBanner } from './SafetyNoticeBanner';

type Props = {
  readonly machineKind: MachineKind;
  readonly autofocusBusy: boolean;
  readonly motionOperation: ReturnType<typeof useLaserStore.getState>['motionOperation'];
  readonly controllerOperation: ReturnType<typeof useLaserStore.getState>['controllerOperation'];
  readonly openRequest: DeviceSetupOpenRequest | undefined;
  readonly onForget: () => void;
};

export function ControllerConnectionControls(props: Props): JSX.Element {
  const platform = usePlatform();
  const connection = useLaserStore((state) => state.connection);
  const qualification = useLaserStore((state) => state.controllerQualification);
  const connectController = useLaserStore((state) => state.connect);
  const disconnectController = useLaserStore((state) => state.disconnect);
  const retryQualification = useLaserStore((state) => state.retryControllerQualification);
  const controllerKind = useStore((state) => state.project.device.controllerKind);
  const profileBaudRate = useStore((state) => state.project.device.baudRate);
  const supportsSerial = platform.serial.isSupported();
  const isFileOnlyProfile = isFileOnlyController(controllerKind);
  const connect = (): void => {
    void connectController(platform, { controllerKind, baudRate: profileBaudRate });
  };
  const reconnect = async (): Promise<void> => {
    await disconnectController();
    await connectController(platform, { controllerKind, baudRate: profileBaudRate });
  };
  return (
    <>
      <SafetyNoticeBanner
        onReconnect={connect}
        reconnectDisabled={
          !supportsSerial ||
          props.autofocusBusy ||
          props.motionOperation !== null ||
          isFileOnlyProfile
        }
      />
      <ConnectionHints supportsSerial={supportsSerial} isFileOnlyProfile={isFileOnlyProfile} />
      <DeviceSetupControls openRequest={props.openRequest} />
      <ConnectionBar
        connection={connection}
        machineNoun={machineNoun(props.machineKind)}
        onConnect={connect}
        onDisconnect={() => void disconnectController().catch(() => undefined)}
        onForget={props.onForget}
        qualification={qualification}
        onRetryQualification={() => void retryQualification().catch(() => undefined)}
        onReconnectQualification={() => void reconnect().catch(() => undefined)}
        disabled={
          !supportsSerial ||
          connectionControlsBusy(
            props.autofocusBusy,
            props.motionOperation,
            props.controllerOperation,
          ) ||
          isFileOnlyProfile
        }
      />
    </>
  );
}

function ConnectionHints(props: {
  readonly supportsSerial: boolean;
  readonly isFileOnlyProfile: boolean;
}): JSX.Element | null {
  if (props.isFileOnlyProfile) {
    return (
      <p style={hintStyle}>
        This profile is file-export only: use Save G-code… to write an experimental .rd job and run
        it from the machine panel. Live Ruida streaming is not available in this build.
      </p>
    );
  }
  if (!props.supportsSerial) {
    return (
      <p style={hintStyle}>
        Your browser doesn&apos;t support WebSerial. Use Chrome, Edge, Brave (may require enabling
        under Brave Shields/flags), or Arc, or install the Windows desktop app.
      </p>
    );
  }
  return null;
}

function isFileOnlyController(
  controllerKind: Parameters<typeof selectControllerDriver>[0],
): boolean {
  return selectControllerDriver(controllerKind).capabilities.transport === 'file-only';
}

// Connection management is the escape hatch for a stale reset or startup
// handshake. Keep Disconnect/Reconnect available for those controller-owned
// operations while motion and autofocus retain their stricter lockout.
function connectionControlsBusy(
  autofocusBusy: boolean,
  motionOperation: unknown,
  controllerOperation: ReturnType<typeof useLaserStore.getState>['controllerOperation'],
): boolean {
  if (autofocusBusy || motionOperation !== null) return true;
  return (
    controllerOperation !== null &&
    controllerOperation.kind !== 'recovery' &&
    controllerOperation.kind !== 'connection-handshake'
  );
}

const hintStyle: React.CSSProperties = {
  color: 'var(--lf-danger-fg)',
  fontStyle: 'italic',
  margin: 0,
};
