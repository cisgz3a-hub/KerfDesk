import type { DeviceProfile } from '../../core/devices';
import type { MachineNetworkProtocol } from '../../platform/types';

export type MachineNetworkKind = 'fluidnc-network' | 'grblhal-network';
type NetworkProfile = {
  readonly kind: MachineNetworkKind;
  readonly controllerKind: 'fluidnc' | 'grblhal';
  readonly protocol: MachineNetworkProtocol;
  readonly label: string;
  readonly portSetting: string;
  readonly channelDescription: string;
};

const PROFILES: Readonly<Record<MachineNetworkKind, NetworkProfile>> = {
  'fluidnc-network': {
    kind: 'fluidnc-network',
    controllerKind: 'fluidnc',
    protocol: 'fluidnc-telnet',
    label: 'FluidNC',
    portSetting: 'Telnet/Port',
    channelDescription: 'Enable the Telnet channel in your controller settings.',
  },
  'grblhal-network': {
    kind: 'grblhal-network',
    controllerKind: 'grblhal',
    protocol: 'grblhal-raw',
    label: 'grblHAL',
    portSetting: 'Telnet port',
    channelDescription:
      'Your board and firmware must support networking with the raw Telnet service enabled.',
  },
};

export function machineNetworkProfile(kind: MachineNetworkKind): NetworkProfile {
  return PROFILES[kind];
}

/** A vendor command override does not establish its network protocol. */
export function machineNetworkProfileForDevice(device: DeviceProfile): NetworkProfile | null {
  if (device.controllerCommandSet !== undefined) return null;
  return (
    Object.values(PROFILES).find((profile) => profile.controllerKind === device.controllerKind) ??
    null
  );
}
