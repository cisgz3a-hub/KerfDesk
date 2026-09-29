// A saved copy of a built-in preset that lacks the preset's vendor command set.
//
// Device profiles are saved whole, so a later catalog change never reaches a
// copy saved before it. The Creality Falcon A1 Pro preset gained its vendor
// command set on 2026-09-19 (#796, ADR-322 §4). An A1 Pro profile saved before
// then connects with the generic grblHAL driver, whose Frame tool-off sends M9
// just before Start (ADR-323). The saved-profile note asks for deliberate
// preset reapplication (docs/audits/2026-09-19-machine-compatibility-fixes/
// README.md), so this only names the preset for Job Review and for Machine
// Setup's preset card; nothing is migrated (ADR-375, as ADR-370 does for air).
//
// selectControllerDriver applies a vendor command set only on the GRBL-family
// labels. A copy moved to another family dropped it on purpose, so it is never
// flagged.
import type { ControllerCommandSet, DeviceProfile } from './device-profile';
import { profileCatalogEntryById } from './profile-catalog';

export type PresetCommandSetUpdate = {
  readonly presetName: string;
  readonly commandSet: ControllerCommandSet;
};

/** The preset's command set for a saved preset copy that lacks it; null otherwise. */
export function presetCommandSetUpdate(
  device: Pick<DeviceProfile, 'profileId' | 'controllerKind' | 'controllerCommandSet'>,
): PresetCommandSetUpdate | null {
  if (device.profileId === undefined) return null;
  const preset = profileCatalogEntryById(device.profileId)?.profile;
  const commandSet = preset?.controllerCommandSet;
  if (preset === undefined || commandSet === undefined) return null;
  if (device.controllerCommandSet === commandSet) return null;
  const kind = device.controllerKind ?? 'grbl-v1.1';
  if (kind !== 'grbl-v1.1' && kind !== 'grblhal') return null;
  return { presetName: preset.name, commandSet };
}
