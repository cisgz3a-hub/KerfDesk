import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createMachineProfileDocument,
  deserializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  serializeMachineProfileDocument,
} from './machine-profile-io';

describe('LaserForge machine profile document IO', () => {
  it('serializes deterministic .lfmachine.json documents with review notes', () => {
    const doc = createMachineProfileDocument(DEFAULT_DEVICE_PROFILE, {
      source: { kind: 'built-in', label: 'LaserForge catalog' },
      reviewNotes: ['Confirm homing and air assist before first burn.'],
    });

    const text = serializeMachineProfileDocument(doc);

    expect(text).toBe(serializeMachineProfileDocument(doc));
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('"format": "laserforge-machine-profile"');
    expect(JSON.parse(text)).toEqual({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: DEFAULT_DEVICE_PROFILE,
      source: { kind: 'built-in', label: 'LaserForge catalog' },
      reviewNotes: ['Confirm homing and air assist before first burn.'],
    });
  });

  it('roundtrips a valid profile document', () => {
    const doc = createMachineProfileDocument(DEFAULT_DEVICE_PROFILE, {
      source: { kind: 'custom', label: 'Shop profile' },
    });

    const result = deserializeMachineProfileDocument(serializeMachineProfileDocument(doc));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.document).toEqual(doc);
    }
  });

  it('rejects wrong formats, newer schemas, and invalid profile payloads', () => {
    expect(
      deserializeMachineProfileDocument(
        JSON.stringify({ format: 'lightburn', schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION }),
      ).kind,
    ).toBe('invalid');

    const tooNew = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION + 1,
        profile: DEFAULT_DEVICE_PROFILE,
        source: { kind: 'custom', label: 'Future' },
        reviewNotes: [],
      }),
    );
    expect(tooNew.kind).toBe('schema-too-new');

    const invalidProfile = deserializeMachineProfileDocument(
      JSON.stringify({
        format: MACHINE_PROFILE_FORMAT,
        schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
        profile: { ...DEFAULT_DEVICE_PROFILE, bedWidth: -1 },
        source: { kind: 'custom', label: 'Broken' },
        reviewNotes: [],
      }),
    );
    expect(invalidProfile.kind).toBe('invalid');
    if (invalidProfile.kind === 'invalid') {
      expect(invalidProfile.reason).toMatch(/bedWidth/);
    }
  });
});
