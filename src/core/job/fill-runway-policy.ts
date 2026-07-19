import { resolveGrblDialect, type DeviceProfile } from '../devices';

export type FillRunwayPolicy = 'feed-matched-entry';

export function fillRunwayPolicyForDevice(device: DeviceProfile): FillRunwayPolicy | undefined {
  return resolveGrblDialect(device).id === 'neotronics-4040-safe'
    ? 'feed-matched-entry'
    : undefined;
}
