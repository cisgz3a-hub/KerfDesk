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

  it.each(['M3 S1', 'M64 P0\nM3', 'G0 X10'])(
    'rejects executable injection in project and profile imports: %s',
    (onCommand) => {
      const light = { ...positioningLight, onCommand };
      const project = createProject({ ...DEFAULT_DEVICE_PROFILE, positioningLight: light });
      expect(deserializeProject(serializeProject(project)).kind).toBe('invalid');
      const result = deserializeMachineProfileDocument(
        JSON.stringify({
          format: MACHINE_PROFILE_FORMAT,
          schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
          profile: project.device,
          source: { kind: 'custom', label: 'Invalid pointer' },
          reviewNotes: [],
        }),
      );
      expect(result.kind).toBe('invalid');
    },
  );
  it.each([
    ['fluidnc', 'M64 P8', 'M65 P8'],
    ['grblhal', 'M62 P0', 'M63 P0'],
    ['fluidnc', 'M64 P0', 'M65 P1'],
    ['marlin', 'M355 S1', 'M0355 S1'],
    ['marlin', 'M125', 'M355 S0'],
  ] as const)(
    'rejects invalid %s mappings in both import formats',
    (controllerKind, onCommand, offCommand) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind,
        positioningLight: { ...positioningLight, onCommand, offCommand },
      };
      expect(deserializeProject(serializeProject(createProject(device))).kind).toBe('invalid');
      expect(deserializeMachineProfileDocument(profileDocument(device))).toMatchObject({
        kind: 'invalid',
        reason: expect.stringContaining('Positioning light'),
      });
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
