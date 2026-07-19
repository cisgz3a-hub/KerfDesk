import type { DeviceProfile } from '../../../core/devices';
import type { Job } from '../../../core/job';

const MANUAL_AIR_WARNING =
  'This reviewed job requests air assist, but the device has no M7/M8 output configured. ' +
  'KerfDesk will emit no M7/M8 command. Start the external/manual air pump before Start and ' +
  'keep it running for the whole job, or configure a relay command only after a hardware test.';

export function detectManualAirAssistWarnings(
  job: Job,
  device: Pick<DeviceProfile, 'airAssistCommand'>,
): ReadonlyArray<string> {
  if (device.airAssistCommand !== 'none') return [];
  return job.groups.some((group) => group.kind !== 'cnc' && group.airAssist)
    ? [MANUAL_AIR_WARNING]
    : [];
}
