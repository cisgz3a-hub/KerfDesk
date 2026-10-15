import type { DeviceProfile } from '../../../core/devices';
import type { PlatformAdapter, SerialAdapter } from '../../../platform/types';
import { connectOptionsForDevice } from '../../commands/connect-options';
import type { ConnectControllerOptions, useLaserStore } from '../../state/laser-store';
import { machineNetworkProfile, type MachineNetworkKind } from '../machine-network-profile';

/** A first network Connect owns this target only for the setup request it opens. */
export type MachineSetupConnection = {
  readonly kind: MachineNetworkKind;
  readonly serial: SerialAdapter;
  readonly host: string;
  readonly port: number;
};

type Connect = ReturnType<typeof useLaserStore.getState>['connect'];

export function connectionForMachineSetup(
  platform: PlatformAdapter,
  draft: DeviceProfile,
  baudRate: number,
  connection?: MachineSetupConnection,
) {
  const controllerKind = draft.controllerKind ?? 'grbl-v1.1';
  const networkProfile = connection === undefined ? null : machineNetworkProfile(connection.kind);
  const blockedReason =
    networkProfile !== null &&
    (controllerKind !== networkProfile.controllerKind || draft.controllerCommandSet !== undefined)
      ? `Select the ${networkProfile.label} protocol before retrying this network connection.`
      : null;
  const adapter = connection === undefined ? platform : { ...platform, serial: connection.serial };
  return {
    networkTarget: connection === undefined ? undefined : `${connection.host}:${connection.port}`,
    blockedReason,
    supportsSerial: adapter.serial.isSupported(),
    connect: (connect: Connect, extra: Partial<ConnectControllerOptions> = {}): Promise<void> => {
      if (blockedReason !== null) return Promise.reject(new Error(blockedReason));
      return connect(adapter, {
        ...connectOptionsForDevice(draft),
        controllerKind,
        baudRate,
        ...extra,
        ...(connection === undefined ? {} : { hostedStreaming: false, portSelection: 'choose' }),
      });
    },
  };
}
