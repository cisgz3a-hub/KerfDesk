import { describe, expect, it } from 'vitest';
import {
  GRBL_MACHINE_PROFILE_CATALOG,
  duplicateProfileAsCustom,
  profileCatalogEntryById,
  profileSupportsCapability,
  validateMachineProfile,
} from './profile-catalog';
import { profileConfidenceLabel } from './profile-confidence';

describe('GRBL_MACHINE_PROFILE_CATALOG', () => {
  it('ships the required built-in GRBL profiles with valid evidence', () => {
    expect(GRBL_MACHINE_PROFILE_CATALOG.map((entry) => entry.profile.profileId)).toEqual([
      'generic-grbl-400x400',
      'creality-falcon-a1-pro-grblhal',
      'creality-falcon-a1-pro-compatible',
      'neotronics-4040-max-lt4lds-v2-20w',
      'xtool-d1-pro',
      'sculpfun-s30',
      'ortur-laser-master-3',
      'generic-grblhal',
      'generic-fluidnc',
      'generic-marlin-laser',
      'generic-smoothieware',
      'generic-ruida-rd-export',
    ]);
    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      expect(validateMachineProfile(entry.profile)).toEqual([]);
      expect(entry.evidence.length).toBeGreaterThan(0);
      expect(entry.profile.scanningOffsets).toEqual([]);
    }
  });

  it('ships a specific Falcon A1 Pro grblHAL profile before the broad fallback', () => {
    const specific = profileCatalogEntryById('creality-falcon-a1-pro-grblhal');
    const fallback = profileCatalogEntryById('creality-falcon-a1-pro-compatible');
    if (specific === undefined || fallback === undefined)
      throw new Error('Falcon profiles missing');

    expect(specific.profile.controllerKind).toBe('grblhal');
    expect(specific.profile.name).toBe('Creality Falcon A1 Pro (grblHAL)');
    expect(profileConfidenceLabel(specific.profile)).toBe('Hardware verified');
    expect(fallback.profile.name).toBe('Creality Falcon-compatible GRBL diode');
    expect(fallback.profile.profileId).toBe('creality-falcon-a1-pro-compatible');
  });

  it('marks the brand starter profiles as public-spec starters so operators confirm specs', () => {
    for (const profileId of ['xtool-d1-pro', 'sculpfun-s30', 'ortur-laser-master-3'] as const) {
      const entry = profileCatalogEntryById(profileId);
      if (entry === undefined) throw new Error(`missing catalog profile: ${profileId}`);
      expect(validateMachineProfile(entry.profile)).toEqual([]);
      expect(entry.profile.evidence?.every((item) => item.status === 'public-spec-starter')).toBe(
        true,
      );
      expect(profileConfidenceLabel(entry.profile)).toBe('Public-spec starter');
      expect(entry.profile.bedWidth).toBeGreaterThan(0);
      expect(entry.profile.bedHeight).toBeGreaterThan(0);
    }
  });

  it('gives every built-in profile a user-facing confidence label', () => {
    const labels = GRBL_MACHINE_PROFILE_CATALOG.map((entry) =>
      profileConfidenceLabel(entry.profile),
    );
    expect(labels).toEqual([
      'Default starter',
      'Hardware verified',
      'Simulator tested',
      'Simulator tested',
      'Public-spec starter',
      'Public-spec starter',
      'Public-spec starter',
      'Simulator tested',
      'Simulator tested',
      'Simulator tested',
      'Simulator tested',
      'Experimental',
    ]);
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

  it('requires camera capability and camera profile metadata to agree', () => {
    const source = GRBL_MACHINE_PROFILE_CATALOG[0]?.profile;
    if (source === undefined) throw new Error('catalog profile missing');
    const cameraProfile = {
      id: 'bench-camera',
      name: 'Bench camera',
      deviceId: 'webcam-1',
      enabled: false,
      transparency: 0.35,
    };

    expect(
      validateMachineProfile({
        ...source,
        capabilities: [...(source.capabilities ?? []), 'camera'],
      }),
    ).toContain('camera capability requires cameraProfile');

    expect(
      validateMachineProfile({
        ...source,
        cameraProfile,
      }),
    ).toContain('cameraProfile requires camera capability');

    expect(
      validateMachineProfile({
        ...source,
        capabilities: [...(source.capabilities ?? []), 'camera'],
        cameraProfile,
      }),
    ).toEqual([]);
  });
});
