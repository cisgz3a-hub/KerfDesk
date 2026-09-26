import { describe, expect, it } from 'vitest';
import {
  SCULPFUN_S30_MANUAL_AIR_PROFILE,
  SCULPFUN_S30_PROFILE,
  XTOOL_D1_PRO_PROFILES,
} from './brand-laser-profiles';
import type { DeviceProfile } from './device-profile';
import { stalePresetCorrections } from './preset-corrections';

// 2026-09-25 PR audit SET-1: #894 corrected these presets in the catalog only.
// A copy saved before it kept the old value, and nothing said so.
const S30_PRESETS = [SCULPFUN_S30_PROFILE, SCULPFUN_S30_MANUAL_AIR_PROFILE];

function withoutProfileId(profile: DeviceProfile): DeviceProfile {
  const { profileId: _profileId, ...rest } = profile;
  return rest;
}

describe('stalePresetCorrections', () => {
  it('names a saved xTool D1 Pro copy that still has the old front-left origin', () => {
    for (const preset of XTOOL_D1_PRO_PROFILES) {
      expect(stalePresetCorrections({ ...preset, origin: 'front-left' })).toEqual([
        {
          presetName: preset.name,
          before: 'origin front-left',
          now: 'rear-left',
          effect: expect.any(String),
        },
      ]);
      expect(stalePresetCorrections(preset)).toEqual([]);
    }
  });

  it('names a saved S30 copy that still has the old 410 x 400 mm bed', () => {
    for (const preset of S30_PRESETS) {
      expect(stalePresetCorrections({ ...preset, bedWidth: 410, bedHeight: 400 })).toHaveLength(1);
      expect(stalePresetCorrections(preset)).toEqual([]);
    }
  });

  it("leaves the operator's own values and other profiles alone", () => {
    const [xtool] = XTOOL_D1_PRO_PROFILES;
    const [s30] = S30_PRESETS;
    if (xtool === undefined || s30 === undefined) throw new Error('missing preset');
    expect(stalePresetCorrections({ ...xtool, origin: 'rear-right' })).toEqual([]);
    // The S30's Y-axis extension kit gives 380 x 920 mm.
    expect(stalePresetCorrections({ ...s30, bedWidth: 380, bedHeight: 920 })).toEqual([]);
    expect(stalePresetCorrections({ ...withoutProfileId(xtool), origin: 'front-left' })).toEqual(
      [],
    );
    expect(
      stalePresetCorrections({ ...xtool, profileId: 'custom-machine', origin: 'front-left' }),
    ).toEqual([]);
  });

  it('gives every corrected preset a new catalog version', () => {
    for (const preset of [...XTOOL_D1_PRO_PROFILES, ...S30_PRESETS]) {
      expect(preset.catalogVersion).toBe('2026-09-24');
    }
  });
});
