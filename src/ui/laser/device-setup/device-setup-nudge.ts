// Setup identity and the passive "set up this machine" nudge (FU-4). Pure
// logic only — no React or storage. Explicit Connect also uses this identity
// to open setup for an unfinished profile; automatic connections only nudge.
//
// A machine is keyed by its committed profile identity, bed, and controller
// family. GRBL $$ carries no serial number, but including controller identity
// prevents a corrected controller profile from inheriting a
// stale setup mark; Finish records the corrected signature. (Edge: two
// machines both left on the untouched generic profile share a signature, so
// setting one up shares its completion mark with the other. This is profile
// history, not physical-machine identity.)

import type { DeviceProfile } from '../../../core/devices';
import type { MachineKind } from '../../../core/scene';

// Laser and CNC are set up separately (spindle, safe Z and CNC speed limits are
// their own values), so setting up one never marks the other as done. Laser
// keeps the original signature so existing marks survive.
export function deviceProfileSignature(
  profile: DeviceProfile,
  machineKind: MachineKind = 'laser',
): string {
  const id = profile.profileId ?? profile.name;
  const base = `${id}:${profile.bedWidth}x${profile.bedHeight}:${profile.controllerKind ?? 'grbl-v1.1'}`;
  return machineKind === 'cnc' ? `${base}:cnc` : base;
}

export function shouldPromptDeviceSetup(input: {
  readonly connected: boolean;
  readonly device: DeviceProfile;
  readonly machineKind?: MachineKind;
  readonly configured: ReadonlySet<string>;
}): boolean {
  // Only nudge when actually connected — an unconfigured profile sitting idle
  // with no controller is not actionable.
  if (!input.connected) return false;
  return !input.configured.has(deviceProfileSignature(input.device, input.machineKind));
}
