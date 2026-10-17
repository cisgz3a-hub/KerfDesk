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
});
