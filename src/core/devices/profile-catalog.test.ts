import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import {
  duplicateProfileAsCustom,
  GRBL_MACHINE_PROFILE_CATALOG,
  profileCatalogEntryById,
  profileSupportsCapability,
  validateMachineProfile,
} from './profile-catalog';

describe('GRBL machine profile catalog', () => {
  it('ships only evidence-backed built-in GRBL profiles for v1', () => {
    expect(GRBL_MACHINE_PROFILE_CATALOG.map((entry) => entry.profile.profileId)).toEqual([
      'generic-grbl-400x400',
      'creality-falcon-a1-pro-compatible',
      'neotronics-4040-max-lt4lds-v2-20w',
    ]);

    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      expect(entry.profile.profileSource).toBe('built-in');
      expect(entry.profile.controllerKind).toBe('grbl-v1.1');
      expect(entry.profile.capabilities).toContain('grbl');
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(validateMachineProfile(entry.profile)).toEqual([]);
    }
  });

  it('indexes entries by deterministic profile id', () => {
    expect(profileCatalogEntryById('neotronics-4040-max-lt4lds-v2-20w')?.profile.name).toBe(
      'Neotronics 4040 Max / LT-4LDS-V2 20W',
    );
    expect(profileCatalogEntryById('missing-profile')).toBeUndefined();
  });

  it('duplicates a built-in profile as a custom profile without mutating safety fields', () => {
    const custom = duplicateProfileAsCustom(DEFAULT_DEVICE_PROFILE, {
      profileId: 'custom-shop-falcon',
      name: 'Shop Falcon',
    });

    expect(custom).toMatchObject({
      profileId: 'custom-shop-falcon',
      name: 'Shop Falcon',
      profileSource: 'custom',
      bedWidth: DEFAULT_DEVICE_PROFILE.bedWidth,
      bedHeight: DEFAULT_DEVICE_PROFILE.bedHeight,
      maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
    });
    expect(custom).not.toHaveProperty('catalogVersion');
    expect(custom).not.toBe(DEFAULT_DEVICE_PROFILE);
  });

  it('keeps capabilities queryable without callers poking optional arrays', () => {
    expect(profileSupportsCapability(DEFAULT_DEVICE_PROFILE, 'grbl')).toBe(true);
    expect(profileSupportsCapability(DEFAULT_DEVICE_PROFILE, 'camera-ready')).toBe(false);
  });
});
