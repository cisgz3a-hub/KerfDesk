import { describe, expect, it } from 'vitest';
import { selectControllerDriver } from '../../core/controllers';
import { GRBL_MACHINE_PROFILE_CATALOG, validateMachineProfile } from '../../core/devices';
import { selectOutputStrategy } from '../../core/output';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from '../gcode';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from './machine-profile-io';

describe('built-in machine profile workflow coverage', () => {
  it('validates, resolves drivers/output, round-trips, and exports a tiny safe line job', () => {
    for (const entry of GRBL_MACHINE_PROFILE_CATALOG) {
      const profile = entry.profile;
      expect(validateMachineProfile(profile), profile.profileId).toEqual([]);
      expect(selectControllerDriver(profile.controllerKind).kind, profile.profileId).toBe(
        profile.controllerKind ?? 'grbl-v1.1',
      );
      expect(selectOutputStrategy(profile).id, profile.profileId).toMatch(
        /^(grbl|marlin|smoothieware)$/,
      );

      const serialized = serializeMachineProfileDocument({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile,
        source: { kind: profile.profileSource ?? 'custom', label: profile.name },
        reviewNotes: entry.reviewNotes,
      });
      const roundTrip = deserializeMachineProfileDocument(serialized);
      expect(roundTrip.kind, profile.profileId).toBe('ok');
      if (roundTrip.kind !== 'ok') throw new Error(`round-trip failed: ${profile.profileId}`);
      expect(roundTrip.document.profile.profileId, profile.profileId).toBe(profile.profileId);

      const output = emitGcode(tinyLineProject(profile));
      expect(output.preflight.ok, profile.profileId).toBe(true);
      expect(output.gcode, profile.profileId).toMatch(/G21/);
      expect(output.gcode, profile.profileId).toMatch(/G0|G1/);
    }
  });
});

function tinyLineProject(device: Project['device']): Project {
  const color = '#ff0000';
  const line: SceneObject = {
    kind: 'imported-svg',
    id: 'tiny-line',
    source: 'tiny-line.svg',
    bounds: { minX: 1, minY: 1, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            points: [
              { x: 1, y: 1 },
              { x: 2, y: 1 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const layer = createLayer({ id: 'line-red', color });
  return {
    ...createProject(device),
    scene: {
      layers: [layer],
      objects: [line],
    },
  };
}
