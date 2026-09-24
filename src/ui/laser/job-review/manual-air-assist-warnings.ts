import type { DeviceProfile } from '../../../core/devices';
// Deep import: the devices barrel is at its public-export ratchet.
import { presetAirAssistUpdate } from '../../../core/devices/preset-air-assist';
import type { Job } from '../../../core/job';

const MANUAL_AIR_WARNING =
  'This reviewed job requests air assist, but the device has no M7/M8 output configured. ' +
  'KerfDesk will emit no M7/M8 command. Start the external/manual air pump before Start and ' +
  'keep it running for the whole job, or configure a relay command only after a hardware test.';

export function detectManualAirAssistWarnings(
  job: Job,
  device: Pick<DeviceProfile, 'airAssistCommand' | 'profileId'>,
): ReadonlyArray<string> {
  if (device.airAssistCommand !== 'none') return [];
  if (!job.groups.some((group) => group.kind !== 'cnc' && group.airAssist)) return [];
  // A saved preset whose air predates the preset's own (ADR-370).
  const preset = presetAirAssistUpdate(device);
  return preset === null
    ? [MANUAL_AIR_WARNING]
    : [
        `${MANUAL_AIR_WARNING} The ${preset.presetName} preset uses ` +
          `${preset.patch.airAssistCommand}; Machine Setup's Air output row offers to apply it.`,
      ];
}
