// ADR-500: when the first-run machine banner shows, and what it offers. Pure
// logic: no React and no storage.
//
// Every session starts on the generic 400 × 400 mm starter machine (F-A1). The
// banner shows while the project still has that machine exactly as it ships
// and nobody has set that machine up. Any change to the machine (Machine Setup,
// a machine profile import, an opened or restored project, Use last machine,
// or an edit to the profile) hides it.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import { serializeCanonicalDeviceProfile } from '../../io/machine-profile/machine-profile-io';
import { deviceProfileSignature } from '../laser/device-setup/device-setup-nudge';

export type MachineSetupBannerState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'first-run' }
  | { readonly kind: 'last-machine'; readonly machine: DeviceProfile };

let starterCanonical: string | null = null;

/** True for the starter machine exactly as it ships, before any edit. */
export function isStarterMachine(device: DeviceProfile): boolean {
  if (device === DEFAULT_DEVICE_PROFILE) return true;
  starterCanonical ??= serializeCanonicalDeviceProfile(DEFAULT_DEVICE_PROFILE);
  return serializeCanonicalDeviceProfile(device) === starterCanonical;
}

export function machineSetupBannerState(input: {
  readonly device: DeviceProfile;
  readonly configured: ReadonlySet<string>;
  readonly lastMachine: DeviceProfile | null;
  readonly dismissed: boolean;
  /** The G-code view's bar or the registration jig panel holds the canvas's top right corner. */
  readonly cornerTaken?: boolean;
}): MachineSetupBannerState {
  if (input.dismissed || input.cornerTaken === true || !isStarterMachine(input.device)) {
    return { kind: 'hidden' };
  }
  // Someone who set up the starter machine itself, as a laser or a CNC, chose it.
  if (
    input.configured.has(deviceProfileSignature(input.device, 'laser')) ||
    input.configured.has(deviceProfileSignature(input.device, 'cnc'))
  ) {
    return { kind: 'hidden' };
  }
  if (input.lastMachine !== null && !isStarterMachine(input.lastMachine)) {
    return { kind: 'last-machine', machine: input.lastMachine };
  }
  return { kind: 'first-run' };
}
