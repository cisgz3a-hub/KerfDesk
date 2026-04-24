import type { DeviceProfile } from '../../devices/DeviceProfile';

export const NEGATIVE_COORD_SETTINGS_HINT =
  " If your machine legitimately supports negative workspace, enable 'Allow negative workspace coordinates' in Machine settings.";

export function negativeCoordPreflightSeverity(
  profile: DeviceProfile | null | undefined,
): 'error' | 'warning' {
  return profile?.allowsNegativeWorkspace === true ? 'warning' : 'error';
}
