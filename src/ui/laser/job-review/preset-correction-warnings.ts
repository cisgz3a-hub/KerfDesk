import type { DeviceProfile } from '../../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import {
  stalePresetCorrections,
  withdrawnPresetCopy,
} from '../../../core/devices/preset-corrections';

/** Job Review advisory for a saved preset copy that predates a correction. */
export function detectPresetCorrectionWarnings(
  device: Pick<
    DeviceProfile,
    'profileId' | 'origin' | 'bedWidth' | 'bedHeight' | 'homing' | 'kinematics'
  >,
): ReadonlyArray<string> {
  const withdrawn = withdrawnPresetCopy(device);
  return [
    ...stalePresetCorrections(device).map(
      (correction) =>
        `This machine profile is a copy of the ${correction.presetName} preset saved before ` +
        `the preset was corrected: it still has ${correction.before}, and the preset now uses ` +
        `${correction.now}. If your machine matches the preset, ${correction.effect}. ` +
        'Machine Setup offers the corrected value in one click; check it before starting.',
    ),
    ...(withdrawn === null
      ? []
      : [
          `This machine profile is a copy of the ${withdrawn.presetName} preset, which ` +
            `Machine Setup no longer lists: ${withdrawn.reason}. If your machine is smaller, ` +
            "a job near the edge can run past the real travel. Set your machine's work area " +
            'in Machine Setup before starting.',
        ]),
  ];
}
