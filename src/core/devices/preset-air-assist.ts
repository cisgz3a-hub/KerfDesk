// A saved copy of a built-in preset whose air output predates the preset's.
//
// Device profiles are saved whole, so a later catalog correction never reaches
// a copy saved before it. The Creality Falcon A1 Pro preset gained its `M8` air
// output on 2026-09-19 (#796) and "Air restart" on 2026-09-21 (#815); an A1 Pro
// profile saved before then still reads Air output Disabled and sends no air
// command at all, while the Air restart row stays hidden. This names the
// preset's air settings so Machine Setup can offer them in one click, and Job
// Review and Manual Air can point there (ADR-370).
//
// Only that clearly stale state is detected: a saved preset with Air output
// Disabled whose preset now defines a command. An operator who chose another
// command, or cleared "Air restart" after setting `$152=100`, has a configured
// air output and is never second-guessed.
import type { DeviceProfile } from './device-profile';
import { profileCatalogEntryById } from './profile-catalog';

export type PresetAirAssistUpdate = {
  readonly presetName: string;
  readonly patch: Pick<DeviceProfile, 'airAssistCommand'> &
    Partial<Pick<DeviceProfile, 'airAssistRestartUnreliable'>>;
};

/** The preset's air settings for a saved preset whose Air output is still
 *  Disabled while the preset now defines one; null otherwise. */
export function presetAirAssistUpdate(
  device: Pick<DeviceProfile, 'profileId' | 'airAssistCommand'>,
): PresetAirAssistUpdate | null {
  if (device.airAssistCommand !== 'none' || device.profileId === undefined) return null;
  const preset = profileCatalogEntryById(device.profileId)?.profile;
  if (preset === undefined || preset.airAssistCommand === 'none') return null;
  return {
    presetName: preset.name,
    patch: {
      airAssistCommand: preset.airAssistCommand,
      ...(preset.airAssistRestartUnreliable === true ? { airAssistRestartUnreliable: true } : {}),
    },
  };
}
