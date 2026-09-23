import { describe, expect, it } from 'vitest';
import {
  GRBL_MACHINE_PROFILE_CATALOG,
  duplicateProfileAsCustom,
  profileCatalogEntryById,
  profileSupportsCapability,
  validateMachineProfile,
} from './profile-catalog';
import { profileConfidenceLabel } from './profile-confidence';
import { controllerCompatibleProfile } from './controller-profile-compatibility';

describe('GRBL_MACHINE_PROFILE_CATALOG', () => {
  it('ships the required built-in GRBL profiles with valid evidence', () => {
    expect(GRBL_MACHINE_PROFILE_CATALOG.map((entry) => entry.profile.profileId)).toEqual([
      'generic-grbl-400x400',
      'creality-falcon-a1-pro-grblhal',
      'creality-falcon-a1-pro-compatible',
      'neotronics-4040-max-lt4lds-v2-20w',
      'xtool-d1-pro',
      'xtool-d1-pro-5w',
      'xtool-d1-pro-10w',
      'xtool-d1-pro-40w',
      'sculpfun-s30',
      'sculpfun-s30-manual-air',
      'ortur-laser-master-3',
      'ortur-laser-master-3-20w',
      'ortur-laser-master-3-40w',
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

  it('keeps every catalog profile coherent with its controller transport and dialect', () => {
    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      const result = controllerCompatibleProfile(entry.profile);
      expect(result.corrections, entry.profile.name).toEqual([]);
      expect(result.profile, entry.profile.name).toEqual(entry.profile);
    }
  });

  it('keeps a revised profile’s own catalogVersion instead of the catalog baseline', () => {
    const revised = profileCatalogEntryById('neotronics-4040-max-lt4lds-v2-20w');
    const baseline = profileCatalogEntryById('xtool-d1-pro');
    if (revised === undefined || baseline === undefined) throw new Error('profiles missing');

    expect(revised.profile.catalogVersion).toBe('2026-09-19');
    expect(baseline.profile.catalogVersion).toBe('2026-09-19');
  });

  it('ships a specific Falcon A1 Pro grblHAL profile before the broad fallback', () => {
    const specific = profileCatalogEntryById('creality-falcon-a1-pro-grblhal');
    const fallback = profileCatalogEntryById('creality-falcon-a1-pro-compatible');
    if (specific === undefined || fallback === undefined)
      throw new Error('Falcon profiles missing');

    expect(specific.profile.controllerKind).toBe('grblhal');
    // ADR-331: grblHAL rings are >= 1 KiB; the stock 120-byte window can starve
    // a 512-block planner on dense raster jobs (simulator-shown).
    expect(specific.profile.rxBufferBytes).toBe(1024);
    expect(profileCatalogEntryById('generic-grblhal')?.profile.rxBufferBytes).toBe(1024);
    expect(fallback.profile.rxBufferBytes).toBe(120);
    expect(specific.profile.name).toBe('Creality Falcon A1 Pro (vendor command set)');
    expect(specific.profile.maxFeed).toBe(10000);
    expect(specific.profile.framingFeedMmPerMin).toBe(10000);
    expect(profileConfidenceLabel(specific.profile)).toBe('Public-spec starter');
    expect(fallback.profile.name).toBe('Creality Falcon-compatible GRBL diode');
    expect(fallback.profile.profileId).toBe('creality-falcon-a1-pro-compatible');
    expect(fallback.profile.maxFeed).toBe(10000);
    expect(fallback.profile.framingFeedMmPerMin).toBe(10000);
  });

  it('marks the brand starter profiles as public-spec starters so operators confirm specs', () => {
    for (const profileId of [
      'neotronics-4040-max-lt4lds-v2-20w',
      'xtool-d1-pro',
      'sculpfun-s30',
      'ortur-laser-master-3',
    ] as const) {
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
    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      expect(profileConfidenceLabel(entry.profile), entry.profile.name).toBeTruthy();
      expect(profileConfidenceLabel(entry.profile), entry.profile.name).not.toBe(
        'Hardware verified',
      );
    }
  });

  it('finds catalog entries by id and reports capabilities', () => {
    const entry = profileCatalogEntryById('neotronics-4040-max-lt4lds-v2-20w');
    expect(entry?.profile.name).toContain('Neotronics');
    expect(entry === undefined ? false : profileSupportsCapability(entry.profile, 'grbl')).toBe(
      true,
    );
    for (const capability of ['laser-output', 'cnc-output', 'z-axis'] as const) {
      expect(
        entry === undefined ? false : profileSupportsCapability(entry.profile, capability),
      ).toBe(true);
    }
    for (const unverifiedCapability of ['verified-origin', 'rotary', 'low-power-fire'] as const) {
      expect(
        entry === undefined ? true : profileSupportsCapability(entry.profile, unverifiedCapability),
      ).toBe(false);
    }
    const marlin = profileCatalogEntryById('generic-marlin-laser');
    expect(marlin === undefined ? true : profileSupportsCapability(marlin.profile, 'rotary')).toBe(
      false,
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

  it('rejects a controlled laser-off seek feed above the machine feed ceiling', () => {
    const source = GRBL_MACHINE_PROFILE_CATALOG[0]?.profile;
    if (source === undefined) throw new Error('catalog profile missing');

    expect(
      validateMachineProfile({
        ...source,
        maxFeed: 1000,
        controlledLaserOffTravelFeedMmPerMin: 1001,
      }),
    ).toContain('controlledLaserOffTravelFeedMmPerMin must not exceed maxFeed');
  });
});
