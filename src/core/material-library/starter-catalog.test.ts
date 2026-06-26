import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { starterLibraryEntryForProfileId } from './starter-catalog';

describe('starterLibraryEntryForProfileId', () => {
  it('returns the catalogued starter presets for a known machine profile', () => {
    const entry = starterLibraryEntryForProfileId(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId);
    expect(entry).not.toBeNull();
    expect(entry?.profile).toBe(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    expect(entry?.presets.length ?? 0).toBeGreaterThan(0);
  });

  it('returns null for a profile that has no catalogued starters', () => {
    expect(starterLibraryEntryForProfileId('some-other-machine')).toBeNull();
  });

  it('returns null when the profile id is undefined', () => {
    expect(starterLibraryEntryForProfileId(undefined)).toBeNull();
  });
});
