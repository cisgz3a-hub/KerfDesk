import type { DeviceProfile } from '../../core/devices';
import {
  savedMachineDifferences,
  type SavedMachineDifference,
} from '../../core/saved-machines/saved-machine-difference';
import { serializeCanonicalDeviceProfile } from '../../io/machine-profile/machine-profile-io';

/** Differences after both copies pass through the machine-profile format's
 * canonical form, so a stored copy and a project copy of the same values
 * never read as changed merely because they were normalized differently. */
export function projectCopyDifferences(
  projectCopy: DeviceProfile,
  saved: DeviceProfile,
): ReadonlyArray<SavedMachineDifference> {
  return savedMachineDifferences(canonical(projectCopy), canonical(saved));
}

function canonical(profile: DeviceProfile): DeviceProfile {
  return JSON.parse(serializeCanonicalDeviceProfile(profile)) as DeviceProfile;
}
