import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
} from './machine-profile-io';

describe('vendor command contract persistence', () => {
  it('retains the command contract through export and import of a custom profile', () => {
    const text = serializeMachineProfileDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: {
        ...DEFAULT_DEVICE_PROFILE,
        profileSource: 'custom',
        controllerCommandSet: 'creality-falcon-a1-pro',
      },
      source: { kind: 'custom', label: 'Custom Falcon' },
      reviewNotes: [],
    });
    const loaded = deserializeMachineProfileDocument(text);
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.document.profile.controllerCommandSet).toBe('creality-falcon-a1-pro');
    }
    const invalid = JSON.parse(text) as { profile: { controllerCommandSet: unknown } };
    invalid.profile.controllerCommandSet = { home: 'arbitrary commands' };
    expect(deserializeMachineProfileDocument(JSON.stringify(invalid))).toMatchObject({
      kind: 'invalid',
      reason: 'profile.controllerCommandSet is invalid',
    });
  });
});
