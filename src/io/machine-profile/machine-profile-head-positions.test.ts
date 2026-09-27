// ADR-493: a machine-profile export carries the laser finish position and the
// saved head positions, import validates them with the rules project load
// uses, and a profile that never set them exports without them.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  MACHINE_PROFILE_FORMAT,
  MACHINE_PROFILE_SCHEMA_VERSION,
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from './machine-profile-io';

const SAVED = [
  { name: 'Corner jig', frame: 'bed' as const, xMm: 12.5, yMm: 40 },
  { name: 'Lens check', frame: 'origin' as const, xMm: -5, yMm: 0 },
];

function serialize(profile: DeviceProfile): string {
  return serializeMachineProfileDocument({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: { kind: 'custom', label: 'Head positions' },
    reviewNotes: [],
  });
}

function importReason(patch: Record<string, unknown>): string | null {
  const raw = JSON.parse(serialize(DEFAULT_DEVICE_PROFILE)) as {
    profile: Record<string, unknown>;
  };
  Object.assign(raw.profile, patch);
  const result = deserializeMachineProfileDocument(JSON.stringify(raw));
  return result.kind === 'invalid' ? result.reason : null;
}

describe('machine profile head positions (ADR-493)', () => {
  it('exports and re-imports the finish position and saved positions', () => {
    const profile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      laserFinishPosition: { kind: 'bed', xMm: 10, yMm: 0 },
      savedPositions: SAVED,
    };
    const text = serialize(profile);
    const exported = JSON.parse(text) as { profile: Record<string, unknown> };
    expect(exported.profile['laserFinishPosition']).toEqual({ kind: 'bed', xMm: 10, yMm: 0 });
    expect(exported.profile['savedPositions']).toEqual(SAVED);

    const result = deserializeMachineProfileDocument(text);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.document.profile.laserFinishPosition).toEqual({ kind: 'bed', xMm: 10, yMm: 0 });
    expect(result.document.profile.savedPositions).toEqual(SAVED);
    expect(serialize(result.document.profile)).toBe(text);
  });

  it('round-trips stay and drops keys the fields do not have', () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      laserFinishPosition: { kind: 'stay', xMm: 4 },
    } as unknown as DeviceProfile;
    const result = deserializeMachineProfileDocument(serialize(profile));
    expect(result.kind === 'ok' ? result.document.profile.laserFinishPosition : null).toEqual({
      kind: 'stay',
    });
  });

  it('exports neither field for a profile that never set them', () => {
    const exported = JSON.parse(serialize(DEFAULT_DEVICE_PROFILE)) as {
      profile: Record<string, unknown>;
    };
    expect('laserFinishPosition' in exported.profile).toBe(false);
    expect('savedPositions' in exported.profile).toBe(false);
  });

  it('rejects malformed values on import', () => {
    expect(importReason({ laserFinishPosition: { kind: 'bed', xMm: 1 } })).toBe(
      'profile.laserFinishPosition is invalid',
    );
    expect(importReason({ savedPositions: 'Corner jig' })).toBe(
      'profile.savedPositions is invalid',
    );
    expect(
      importReason({ savedPositions: [SAVED[0], { name: '', frame: 'bed', xMm: 0, yMm: 0 }] }),
    ).toBe('profile.savedPositions[1] is invalid');
    expect(importReason({ savedPositions: [{ name: 'Jig', frame: 'work', xMm: 0, yMm: 0 }] })).toBe(
      'profile.savedPositions[0] is invalid',
    );
  });
});
