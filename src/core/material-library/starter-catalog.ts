// Starter material-library catalog (device-driven). Pairs each machine profile
// with the researched starter material presets validated FOR THAT MACHINE, keyed
// by profile id. The UI offers starters only for the device the operator has
// selected, so one machine's power/speed burn data is never applied to another.
// Add an entry here (with its own researched presets) to support a new machine;
// do not reuse another machine's numbers.

import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../devices';
import {
  NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS,
  type StarterMaterialPreset,
} from './neotronics-4040-presets';

export type StarterLibraryCatalogEntry = {
  readonly profile: DeviceProfile;
  readonly presets: ReadonlyArray<StarterMaterialPreset>;
};

const STARTER_LIBRARY_CATALOG: ReadonlyArray<StarterLibraryCatalogEntry> = [
  {
    profile: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    presets: NEOTRONICS_4040_MAX_LT4LDS_V2_PRESETS,
  },
];

// The catalogued starters for a device profile, or null when none exist for it.
export function starterLibraryEntryForProfileId(
  profileId: string | undefined,
): StarterLibraryCatalogEntry | null {
  if (profileId === undefined) return null;
  return STARTER_LIBRARY_CATALOG.find((entry) => entry.profile.profileId === profileId) ?? null;
}
