import { describe, expect, it } from 'vitest';
import {
  SCULPFUN_S30_MANUAL_AIR_PROFILE,
  SCULPFUN_S30_PROFILE,
  XTOOL_D1_PRO_PROFILES,
} from './brand-laser-profiles';
import type { DeviceProfile } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { stalePresetCorrections, withdrawnPresetCopy } from './preset-corrections';

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
          // ADR-322 Amendment 2: the value Machine Setup's one-click offer applies.
          patch: { origin: 'rear-left' },
        },
      ]);
      expect(stalePresetCorrections(preset)).toEqual([]);
    }
  });

  it('names a saved S30 copy that still has the old 410 x 400 mm bed', () => {
    for (const preset of S30_PRESETS) {
      expect(stalePresetCorrections({ ...preset, bedWidth: 410, bedHeight: 400 })).toEqual([
        expect.objectContaining({ patch: { bedWidth: 380, bedHeight: 385 } }),
      ]);
      expect(stalePresetCorrections(preset)).toEqual([]);
    }
  });

  // Controller audit v2 C7-P2-1 (ADR-660): from 2026-07-07 until #796 the A1 Pro
  // preset spread the generic 400 x 400 mm bed. The machine is 358 x 268 mm.
  it('names a saved Falcon A1 Pro copy that still has the old 400 x 400 mm bed', () => {
    const stale = { ...FALCON_A1_PRO_GRBLHAL_PROFILE, bedWidth: 400, bedHeight: 400 };
    expect(stalePresetCorrections(stale)).toEqual([
      expect.objectContaining({
        presetName: FALCON_A1_PRO_GRBLHAL_PROFILE.name,
        before: 'bed 400 x 400 mm',
        patch: { bedWidth: 358, bedHeight: 268 },
      }),
    ]);
    expect(stalePresetCorrections(FALCON_A1_PRO_GRBLHAL_PROFILE)).toEqual([]);
    expect(
      stalePresetCorrections({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, bedWidth: 400, bedHeight: 300 }),
    ).toEqual([]);
  });

  // Rolling audit v6 K3-P2-1/K3-P2-2 (ADR-322 Amendment 3, ADR-675): the A1 Pro
  // preset inherited homing off and had no kinematics before 2026-10-28.
  it('names a saved Falcon A1 Pro copy with homing off or no kinematics', () => {
    const { kinematics: _kinematics, ...noKinematics } = FALCON_A1_PRO_GRBLHAL_PROFILE;
    const stale = { ...noKinematics, homing: { enabled: false, direction: 'front-left' as const } };
    expect(stalePresetCorrections(stale)).toEqual([
      expect.objectContaining({
        before: 'homing off',
        now: 'homing on at the front left',
        patch: { homing: { enabled: true, direction: 'front-left' } },
      }),
      expect.objectContaining({
        before: 'the Cartesian motion model',
        now: 'CoreXY motion',
        patch: { kinematics: 'corexy' },
      }),
    ]);
    // A layout the operator chose is theirs.
    expect(
      stalePresetCorrections({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, kinematics: 'cartesian' }),
    ).toEqual([]);
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

// Controller audit v2 C7-P2-3 (ADR-660): no Creality machine is 400 x 400 mm, so
// the Falcon-compatible fallback left Machine Setup's list. A saved copy keeps
// resolving, and one that still has that work area is named.
describe('withdrawnPresetCopy', () => {
  it('names a saved copy of the withdrawn Falcon-compatible fallback', () => {
    expect(withdrawnPresetCopy(FALCON_COMPATIBLE_PROFILE)).toEqual({
      presetName: FALCON_COMPATIBLE_PROFILE.name,
      reason: expect.stringContaining('Falcon A1 at 305 x 381 mm'),
    });
  });

  it('leaves a work area the operator set, and every listed preset, alone', () => {
    expect(
      withdrawnPresetCopy({ ...FALCON_COMPATIBLE_PROFILE, bedWidth: 381, bedHeight: 305 }),
    ).toBeNull();
    expect(withdrawnPresetCopy(withoutProfileId(FALCON_COMPATIBLE_PROFILE))).toBeNull();
    expect(withdrawnPresetCopy(FALCON_A1_PRO_GRBLHAL_PROFILE)).toBeNull();
    for (const preset of [...XTOOL_D1_PRO_PROFILES, ...S30_PRESETS]) {
      expect(withdrawnPresetCopy(preset)).toBeNull();
    }
  });
});
