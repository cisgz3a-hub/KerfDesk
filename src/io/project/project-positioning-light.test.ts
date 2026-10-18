import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';
import {
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeCanonicalDeviceProfile,
} from '../machine-profile/machine-profile-io';

const positioningLight = {
  onCommand: 'M355 S1 P255',
  offCommand: 'M355 S0',
  offsetXmm: 12.5,
  offsetYmm: -8,
};

describe('positioning light persistence', () => {
  it('roundtrips the explicit commands and signed bed offsets in projects', () => {
    const project = createProject({ ...DEFAULT_DEVICE_PROFILE, positioningLight });
    const result = deserializeProject(serializeProject(project));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      expect(result.project.device.positioningLight).toEqual(positioningLight);
  });

  it('includes the light in canonical machine profiles and restores it', () => {
    const profile = JSON.parse(
      serializeCanonicalDeviceProfile({ ...DEFAULT_DEVICE_PROFILE, positioningLight }),
    );
    expect(profile.positioningLight).toEqual(positioningLight);
    const result = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile,
        source: { kind: 'custom', label: 'Pointer' },
        reviewNotes: [],
      }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok')
      expect(result.document.profile.positioningLight).toEqual(positioningLight);
  });

  it.each(['M3 S1', 'M64 P0\nM3', 'G0 X10', 'M106 S255', 'M42 P4 S255'])(
    'drops executable injection from project and profile imports without refusing them: %s',
    (onCommand) => {
      const light = { ...positioningLight, onCommand };
      const project = createProject({ ...DEFAULT_DEVICE_PROFILE, positioningLight: light });
      const loaded = deserializeProject(serializeProject(project));
      expect(loaded.kind).toBe('ok');
      if (loaded.kind === 'ok') expect(loaded.project.device.positioningLight).toBeUndefined();
      const result = deserializeMachineProfileDocument(
        JSON.stringify({
          format: MACHINE_PROFILE_FORMAT,
          schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
          profile: project.device,
          source: { kind: 'custom', label: 'Invalid pointer' },
          reviewNotes: [],
        }),
      );
      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(result.document.profile.positioningLight).toBeUndefined();
      expect(result.document.reviewNotes).toContainEqual(
        expect.stringContaining('Positioning light removed'),
      );
    },
  );

  // A Marlin fan-mosfet laser has no positioning light, so any saved one is dropped.
  it.each([
    ['M106 P1 S255', 'M107 P1'],
    ['M355 S1 P255', 'M355 S0'],
  ])('drops a %s light from a Marlin fan-mosfet project and profile', (onCommand, offCommand) => {
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin' as const,
      gcodeDialect: { dialectId: 'marlin-fan' as const },
      positioningLight: { ...positioningLight, onCommand, offCommand },
    };
    const loaded = deserializeProject(serializeProject(createProject(device)));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') expect(loaded.project.device.positioningLight).toBeUndefined();
    const profile = deserializeMachineProfileDocument(profileDocument(device));
    expect(profile.kind).toBe('ok');
    if (profile.kind !== 'ok') return;
    expect(profile.document.profile.positioningLight).toBeUndefined();
    expect(profile.document.reviewNotes).toContainEqual(
      expect.stringContaining('Positioning light removed'),
    );
  });

  // Dropped (never sent), not refused: the file still opens (supersedes #1222's refusal).
  it.each([
    ['fluidnc', 'M64 P8', 'M65 P8'],
    ['grblhal', 'M62 P0', 'M63 P0'],
    ['fluidnc', 'M64 P0', 'M65 P1'],
    ['marlin', 'M355 S1', 'M0355 S1'],
    ['marlin', 'M125', 'M355 S0'],
  ] as const)(
    'drops invalid %s mappings in both import formats',
    (controllerKind, onCommand, offCommand) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind,
        // A Marlin controller needs a Marlin dialect, or the file is invalid for that alone.
        ...(controllerKind === 'marlin'
          ? { gcodeDialect: { dialectId: 'marlin-inline' as const } }
          : {}),
        positioningLight: { ...positioningLight, onCommand, offCommand },
      };
      const project = deserializeProject(serializeProject(createProject(device)));
      expect(project.kind).toBe('ok');
      if (project.kind === 'ok') expect(project.project.device.positioningLight).toBeUndefined();
      const profile = deserializeMachineProfileDocument(profileDocument(device));
      expect(profile.kind).toBe('ok');
      if (profile.kind !== 'ok') return;
      expect(profile.document.profile.positioningLight).toBeUndefined();
      expect(profile.document.reviewNotes).toContainEqual(
        expect.stringContaining('Positioning light removed'),
      );
    },
  );

  it.each(['fluidnc', 'grblhal'] as const)(
    'preserves active-low %s mappings in both import formats',
    (controllerKind) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind,
        positioningLight: { ...positioningLight, onCommand: 'M65 P0', offCommand: 'M64 P0' },
      };
      const project = deserializeProject(serializeProject(createProject(device)));
      const profile = deserializeMachineProfileDocument(profileDocument(device));
      expect(project.kind).toBe('ok');
      expect(profile.kind).toBe('ok');
      if (profile.kind === 'ok')
        expect(profile.document.profile.positioningLight).toEqual(device.positioningLight);
    },
  );
});

function profileDocument(profile: typeof DEFAULT_DEVICE_PROFILE): string {
  return JSON.stringify({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: { kind: 'custom', label: 'Pointer' },
    reviewNotes: [],
  });
}
