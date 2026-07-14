// Passive "set up this machine" nudge (FU-4). Pure logic only — no React, no
// storage. The wizard stays manual (no auto-open); this just decides whether to
// highlight the existing "Set up device" button when the operator is connected
// to a machine whose active profile has not been run through setup yet.
//
// A machine is keyed by its committed profile identity, bed, and controller
// family. GRBL $$ carries no serial number, but including controller identity
// prevents a corrected controller profile from inheriting a
// stale setup mark; Finish records the corrected signature. (Edge: two
// machines both left on the untouched generic profile share a signature, so
// setting one up suppresses the nudge for the other — acceptable for a passive
// hint, and avoided as soon as the Identify step assigns a real profile.)

import type { DeviceProfile } from '../../../core/devices';

export function deviceProfileSignature(profile: DeviceProfile): string {
  const id = profile.profileId ?? profile.name;
  return `${id}:${profile.bedWidth}x${profile.bedHeight}:${profile.controllerKind ?? 'grbl-v1.1'}`;
}

export function shouldPromptDeviceSetup(input: {
  readonly connected: boolean;
  readonly device: DeviceProfile;
  readonly configured: ReadonlySet<string>;
}): boolean {
  // Only nudge when actually connected — an unconfigured profile sitting idle
  // with no controller is not actionable.
  if (!input.connected) return false;
  return !input.configured.has(deviceProfileSignature(input.device));
}
