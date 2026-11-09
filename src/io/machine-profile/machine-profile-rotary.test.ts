import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from './machine-profile-io';
import { MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION } from './machine-profile-rotary-version';

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

  it('round-trips a roller diameter (ADR-373)', () => {
    const rotary = {
      enabled: true,
      type: 'roller' as const,
      mmPerRotation: 40,
      objectDiameterMm: 60,
      rollerDiameterMm: 25,
    };
    const result = deserializeMachineProfileDocument(
      serialize({ ...DEFAULT_DEVICE_PROFILE, rotary }),
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.rotary).toEqual(rotary);
  });

  it('rejects a rotary with a non-positive roller diameter', () => {
    const raw = JSON.parse(serialize(DEFAULT_DEVICE_PROFILE)) as {
      profile: Record<string, unknown>;
    };
    raw.profile['rotary'] = {
      enabled: true,
      type: 'roller',
      mmPerRotation: 40,
      objectDiameterMm: 60,
      rollerDiameterMm: 0,
    };
    const result = deserializeMachineProfileDocument(JSON.stringify(raw));
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toMatch(/rollerDiameterMm/);
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

// ADR-693: a dedicated rotary axis must not reach a reader that would drive it
// as Y, so only such a profile is written as schema 2, which 1.0.30 refuses.
describe('machine profile rotary axis', () => {
  it('writes schema 2 for an A rotary and reads it back', () => {
    const rotary = {
      enabled: true,
      type: 'chuck' as const,
      axis: 'A' as const,
      axisConfirmed: 'A' as const,
      mmPerRotation: 360,
      objectDiameterMm: 80,
    };
    const text = serialize({ ...DEFAULT_DEVICE_PROFILE, rotary });
    expect(JSON.parse(text).schemaVersion).toBe(MACHINE_PROFILE_ROTARY_AXIS_SCHEMA_VERSION);
    const result = deserializeMachineProfileDocument(text);
    expect(result.kind === 'ok' ? result.document.profile.rotary : null).toEqual(rotary);
  });

  it('keeps schema 1 for a Y rotary, so older readers still open it', () => {
    const text = serialize({
      ...DEFAULT_DEVICE_PROFILE,
      rotary: { enabled: true, type: 'chuck', mmPerRotation: 40, objectDiameterMm: 80 },
    });
    expect(JSON.parse(text).schemaVersion).toBe(MACHINE_PROFILE_SCHEMA_VERSION);
  });

  it('refuses an unknown rotary axis', () => {
    const text = serialize({
      ...DEFAULT_DEVICE_PROFILE,
      rotary: { enabled: true, type: 'chuck', mmPerRotation: 40, objectDiameterMm: 80 },
    }).replace('"type": "chuck"', '"type": "chuck",\n      "axis": "B"');
    expect(deserializeMachineProfileDocument(text).kind).toBe('invalid');
  });
});
