import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  resolveGrblDialect,
  type DeviceProfile,
} from '../devices';

export type FillRunwayPolicy = 'feed-matched-entry';

export function fillRunwayPolicyForDevice(device: DeviceProfile): FillRunwayPolicy | undefined {
  return resolveGrblDialect(device).id === 'neotronics-4040-safe'
    ? 'feed-matched-entry'
    : undefined;
}

// The generic 400 x 400 starter is deliberately not treated as proof of
// Neotronics hardware. It is, however, the ambiguous profile operators can
// accidentally leave selected on a real 4040. Surface a conditional advisory
// for that starter (and for a declared 4040 profile whose dialect drifted)
// without warning Falcon or unrelated custom profiles.
export function shouldAdvise4040FillPolicySelection(device: DeviceProfile): boolean {
  if (fillRunwayPolicyForDevice(device) !== undefined) return false;
  return (
    device.profileId === DEFAULT_DEVICE_PROFILE.profileId ||
    device.profileId === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId ||
    device.machineFamily === NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.machineFamily
  );
}
