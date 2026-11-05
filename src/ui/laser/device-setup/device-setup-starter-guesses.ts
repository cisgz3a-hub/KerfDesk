// Review's "Ready to save" checks that the draft is consistent, not that its
// values are the machine's. An unlisted machine still on KerfDesk's starter
// work area or power scale, with nothing read from the controller, says so
// (UX audit U2-P3-2). Save stays enabled: values are the operator's call
// (ADR-228).

import { profileCatalogEntryById, type DeviceProfile } from '../../../core/devices';
import type { DeviceSetupState } from './device-setup-flow';
import {
  draftIsListedMachine,
  machinePickerEntries,
  starterProfile,
} from './machine-picker-entries';

export function starterGuessText(state: DeviceSetupState): string | null {
  if (draftIsListedMachine(state, machinePickerEntries(state))) return null;
  const { draft, detected } = state;
  const starters = starterProfiles(draft);
  const guesses: string[] = [];
  if (
    starters.some((s) => s.bedWidth === draft.bedWidth && s.bedHeight === draft.bedHeight) &&
    detected.bedWidth === undefined &&
    detected.bedHeight === undefined
  ) {
    guesses.push(`Work area ${draft.bedWidth} × ${draft.bedHeight} mm`);
  }
  if (
    state.machineKinds.includes('laser') &&
    starters.some((s) => s.maxPowerS === draft.maxPowerS) &&
    detected.maxPowerS === undefined
  ) {
    guesses.push(`power scale S ${draft.maxPowerS}`);
  }
  if (guesses.length === 0) return null;
  const subject = guesses.join(' and ');
  const verb = guesses.length === 1 ? 'is a starter guess' : 'are starter guesses';
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb} from KerfDesk, not read from your machine. Check against the machine's manual before the first job.`;
}

// The generic starter, and a firmware starter such as Marlin's 300 × 200 bed,
// which that firmware cannot report.
function starterProfiles(draft: DeviceProfile): ReadonlyArray<DeviceProfile> {
  const firmware =
    draft.profileId === undefined ? undefined : profileCatalogEntryById(draft.profileId);
  return firmware !== undefined && firmware.profile.vendor === 'Generic'
    ? [starterProfile(draft), firmware.profile]
    : [starterProfile(draft)];
}
