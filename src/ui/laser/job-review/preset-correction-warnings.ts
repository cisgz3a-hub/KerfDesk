import type { DeviceProfile } from '../../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { stalePresetCorrections } from '../../../core/devices/preset-corrections';

/** Job Review advisory for a saved preset copy that predates a correction. */
export function detectPresetCorrectionWarnings(
  device: Pick<DeviceProfile, 'profileId' | 'origin' | 'bedWidth' | 'bedHeight'>,
): ReadonlyArray<string> {
  return stalePresetCorrections(device).map(
    (correction) =>
      `This machine profile is a copy of the ${correction.presetName} preset saved before ` +
      `the preset was corrected: it still has ${correction.before}, and the preset now uses ` +
      `${correction.now}. If your machine matches the preset, ${correction.effect}. ` +
      'Check it in Machine Setup before starting.',
  );
}
