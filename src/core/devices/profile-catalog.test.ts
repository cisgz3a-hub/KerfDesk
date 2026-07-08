import { describe, expect, it } from 'vitest';
import {
  GRBL_MACHINE_PROFILE_CATALOG,
  duplicateProfileAsCustom,
  profileConfidenceLabel,
  profileCatalogEntryById,
  profileSupportsCapability,
  validateMachineProfile,
} from './profile-catalog';
import { selectControllerDriver } from '../controllers';
import { selectOutputStrategy } from '../output';
import { createRectangle } from '../shapes';
import { addLayer, addObject, createLayer, createProject } from '../scene';
import { emitGcode } from '../../io/gcode';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../../io/machine-profile';
import { deserializeProject, serializeProject } from '../../io/project';
import { emitRdFile } from '../../io/rd';

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

  it('labels every catalog profile with user-facing confidence', () => {
    expect(
      GRBL_MACHINE_PROFILE_CATALOG.map((entry) => [
        entry.profile.profileId,
        profileConfidenceLabel(entry.confidence),
      ]),
    ).toEqual([
      ['generic-grbl-400x400', 'Default starter'],
      ['creality-falcon-a1-pro-grblhal', 'Hardware verified'],
      ['creality-falcon-a1-pro-compatible', 'Simulator tested'],
      ['neotronics-4040-max-lt4lds-v2-20w', 'Public-spec starter'],
      ['xtool-d1-pro', 'Public-spec starter'],
      ['sculpfun-s30', 'Public-spec starter'],
      ['ortur-laser-master-3', 'Public-spec starter'],
      ['generic-grblhal', 'Simulator tested'],
      ['generic-fluidnc', 'Simulator tested'],
      ['generic-marlin-laser', 'Simulator tested'],
      ['generic-smoothieware', 'Simulator tested'],
      ['generic-ruida-rd-export', 'Experimental'],
    ]);
  });

  it('ships a specific Falcon A1 Pro grblHAL profile while keeping the legacy fallback loadable', () => {
    const falcon = profileCatalogEntryById('creality-falcon-a1-pro-grblhal')?.profile;
    const fallback = profileCatalogEntryById('creality-falcon-a1-pro-compatible')?.profile;
    if (falcon === undefined) throw new Error('Falcon grblHAL profile missing');

    expect(falcon).toMatchObject({
      name: 'Creality Falcon A1 Pro (grblHAL)',
      controllerKind: 'grblhal',
      machineFamily: 'creality-falcon',
      airAssistCommand: 'none',
    });
    expect(profileSupportsCapability(falcon, 'air-assist')).toBe(true);
    expect(fallback?.profileId).toBe('creality-falcon-a1-pro-compatible');
  });

  it('keeps air-assist hardware capability separate from enabled output command', () => {
    const falcon = profileCatalogEntryById('creality-falcon-a1-pro-grblhal')?.profile;
    if (falcon === undefined) throw new Error('Falcon grblHAL profile missing');

    expect(profileSupportsCapability(falcon, 'air-assist')).toBe(true);
    expect(falcon.airAssistCommand).toBe('none');
  });

  it('runs every built-in profile through driver, output, IO, and tiny-job workflow', () => {
    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      const profile = entry.profile;
      expect(validateMachineProfile(profile)).toEqual([]);
      expect(selectControllerDriver(profile.controllerKind).kind).toBe(
        profile.controllerKind ?? 'grbl-v1.1',
      );
      expect(selectOutputStrategy(profile).id).toMatch(/^(grbl|marlin|smoothieware)$/);

      const project = projectWithTinyLineJob(profile);
      const loaded = deserializeProject(serializeProject(project));
      expect(loaded.kind).toBe('ok');
      if (loaded.kind !== 'ok') throw new Error('project round-trip failed');
      expect(loaded.project.device.profileId).toBe(profile.profileId);

      const profileDoc = deserializeMachineProfileDocument(
        serializeMachineProfileDocument({
          format: MACHINE_PROFILE_FORMAT,
          schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
          profile,
          source: { kind: 'built-in', label: profile.name },
          reviewNotes: entry.reviewNotes,
        }),
      );
      expect(profileDoc.kind).toBe('ok');

      if (profile.controllerKind === 'ruida') {
        const rd = emitRdFile(project);
        expect(rd.ok).toBe(true);
      } else {
        const emitted = emitGcode(project);
        expect(emitted.preflight.ok).toBe(true);
        expect(emitted.gcode).toContain('G21');
      }
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

function projectWithTinyLineJob(profile: (typeof GRBL_MACHINE_PROFILE_CATALOG)[number]['profile']) {
  const shape = createRectangle({
    id: 'catalog-smoke-rect',
    color: '#ff0000',
    spec: { widthMm: 10, heightMm: 5, cornerRadiusMm: 0 },
  });
  const layer = createLayer({ id: 'catalog-smoke-layer', color: '#ff0000' });
  const project = createProject(profile);
  return {
    ...project,
    scene: addLayer(addObject(project.scene, shape), layer),
  };
}
