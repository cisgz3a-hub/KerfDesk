import { describe, expect, it } from 'vitest';
import {
  GRBL_MACHINE_PROFILE_CATALOG,
  duplicateProfileAsCustom,
  profileCatalogEntryById,
  profileSupportsCapability,
  validateMachineProfile,
} from './profile-catalog';

describe('GRBL_MACHINE_PROFILE_CATALOG', () => {
  it('ships the required built-in GRBL profiles with valid evidence', () => {
    expect(GRBL_MACHINE_PROFILE_CATALOG.map((entry) => entry.profile.profileId)).toEqual([
      'generic-grbl-400x400',
      'creality-falcon-a1-pro-compatible',
      'neotronics-4040-max-lt4lds-v2-20w',
      'xtool-d1-pro',
      'sculpfun-s30',
      'ortur-laser-master-3',
      'generic-grblhal',
      'generic-fluidnc',
      'generic-marlin-laser',
      'generic-smoothieware',
    ]);
    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      expect(validateMachineProfile(entry.profile)).toEqual([]);
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(entry.profile.scanningOffsets).toEqual([]);
    }
  });

  it('marks the brand starter profiles unverified so operators confirm specs', () => {
    for (const profileId of ['xtool-d1-pro', 'sculpfun-s30', 'ortur-laser-master-3'] as const) {
      const entry = profileCatalogEntryById(profileId);
      if (entry === undefined) throw new Error(`missing catalog profile: ${profileId}`);
      expect(validateMachineProfile(entry.profile)).toEqual([]);
      expect(entry.profile.evidence?.every((item) => item.status === 'unverified')).toBe(true);
      expect(entry.profile.bedWidth).toBeGreaterThan(0);
      expect(entry.profile.bedHeight).toBeGreaterThan(0);
    }
  });

  it('finds catalog entries by id and reports capabilities', () => {
    const entry = profileCatalogEntryById('neotronics-4040-max-lt4lds-v2-20w');
    expect(entry?.profile.name).toContain('Neotronics');
    expect(entry === undefined ? false : profileSupportsCapability(entry.profile, 'grbl')).toBe(
      true,
    );
  });

  it('duplicates a built-in profile as a custom editable profile', () => {
    const source = profileCatalogEntryById('generic-grbl-400x400')?.profile;
    if (source === undefined) throw new Error('catalog profile missing');

    const custom = duplicateProfileAsCustom(source, {
      profileId: 'custom-test-profile',
      name: 'Custom Test Profile',
    });

    expect(custom.profileId).toBe('custom-test-profile');
    expect(custom.name).toBe('Custom Test Profile');
    expect(custom.profileSource).toBe('custom');
    expect(custom.catalogVersion).toBeUndefined();
    expect(custom.scanningOffsets).toEqual([]);
  });
});
