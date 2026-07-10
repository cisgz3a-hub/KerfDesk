import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from './machine-profile-io';

// R10 (2026-07-07 review): machine-profile import must validate rotary, or a
// junk-typed rotary silently disables scaling while the dialog shows it
// enabled.

function serialize(profile: DeviceProfile): string {
  return serializeMachineProfileDocument({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: { kind: 'custom', label: 'Rotary bench' },
    reviewNotes: [],
  });
}

describe('machine profile rotary validation', () => {
  it('round-trips a valid rotary setup', () => {
    const text = serialize({
      ...DEFAULT_DEVICE_PROFILE,
      rotary: { enabled: true, type: 'chuck', mmPerRotation: 360, objectDiameterMm: 60 },
    });
    const result = deserializeMachineProfileDocument(text);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.rotary?.mmPerRotation).toBe(360);
  });

  it('rejects a rotary with a non-numeric mmPerRotation', () => {
    // Hand-edited / version-drifted file: mmPerRotation as a string.
    const raw = JSON.parse(serialize(DEFAULT_DEVICE_PROFILE)) as {
      profile: Record<string, unknown>;
    };
    raw.profile['rotary'] = {
      enabled: true,
      type: 'chuck',
      mmPerRotation: '360',
      objectDiameterMm: 60,
    };
    const result = deserializeMachineProfileDocument(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toMatch(/rotary/);
  });
});
