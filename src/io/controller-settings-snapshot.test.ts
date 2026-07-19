import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from '../core/controllers/grbl/grbl-settings';
import {
  CONTROLLER_SETTINGS_SNAPSHOT_FORMAT,
  CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
  controllerSettingsSnapshotToRows,
  createControllerSettingsSnapshot,
  deserializeControllerSettingsSnapshot,
  serializeControllerSettingsSnapshot,
  type ControllerSettingsSnapshot,
} from './controller-settings-snapshot';

function validRawSnapshot(): Record<string, unknown> {
  return {
    format: CONTROLLER_SETTINGS_SNAPSHOT_FORMAT,
    schemaVersion: CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: '2026-07-19T10:20:30.000Z',
    operatorLabel: '4040 baseline',
    profile: { profileId: 'neotronics-4040', name: 'Neotronics 4040' },
    controllerKinds: {
      profile: 'grbl-v1.1',
      active: 'grbl-v1.1',
      detected: 'grblhal',
    },
    settings: [
      { id: 120, rawValue: '250.000' },
      { id: 110, rawValue: '6000' },
    ],
  };
}

describe('controller settings snapshots', () => {
  it('captures only raw id/value evidence, sorts it, and round-trips metadata', () => {
    const rows = settingsMapToRows(
      new Map([
        [120, '250.000'],
        [110, '6000'],
      ]),
    );
    const snapshot = createControllerSettingsSnapshot({
      capturedAt: '2026-07-19T10:20:30.000Z',
      operatorLabel: '4040 baseline',
      profile: { profileId: 'neotronics-4040', name: 'Neotronics 4040' },
      controllerKinds: {
        profile: 'grbl-v1.1',
        active: 'grbl-v1.1',
        detected: 'grblhal',
      },
      settings: rows,
    });

    expect(snapshot.settings).toEqual([
      { id: 110, rawValue: '6000' },
      { id: 120, rawValue: '250.000' },
    ]);
    expect(snapshot.settings[0]).not.toHaveProperty('name');
    expect(snapshot).toMatchObject({
      operatorLabel: '4040 baseline',
      profile: { profileId: 'neotronics-4040', name: 'Neotronics 4040' },
      controllerKinds: {
        profile: 'grbl-v1.1',
        active: 'grbl-v1.1',
        detected: 'grblhal',
      },
    });

    const serialized = serializeControllerSettingsSnapshot(snapshot);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(deserializeControllerSettingsSnapshot(serialized)).toEqual({ kind: 'ok', snapshot });
  });

  it('reconstructs named rows using current setting metadata without changing raw values', () => {
    const result = deserializeControllerSettingsSnapshot(JSON.stringify(validRawSnapshot()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(controllerSettingsSnapshotToRows(result.snapshot)).toMatchObject([
      { id: 110, code: '$110', rawValue: '6000', name: 'X max rate', numericValue: 6000 },
      {
        id: 120,
        code: '$120',
        rawValue: '250.000',
        name: 'X acceleration',
        numericValue: 250,
      },
    ]);
  });

  it.each([
    ['wrong format', { format: 'other' }, 'wrong controller settings snapshot format'],
    ['non-canonical timestamp', { capturedAt: '2026-07-19' }, 'canonical ISO timestamp'],
    ['blank label', { operatorLabel: '  ' }, 'operatorLabel'],
    [
      'unknown active kind',
      { controllerKinds: { profile: null, active: 'mystery', detected: null } },
      'controllerKinds.active',
    ],
    ['invalid profile id', { profile: { profileId: '', name: 'Machine' } }, 'profile.profileId'],
    ['extra top-level data', { writeCommands: ['$120=250'] }, 'unexpected top-level field'],
  ])('rejects %s', (_name, patch, expectedReason) => {
    const result = deserializeControllerSettingsSnapshot(
      JSON.stringify({ ...validRawSnapshot(), ...patch }),
    );
    expect(result).toMatchObject({ kind: 'invalid' });
    if (result.kind === 'invalid') expect(result.reason).toContain(expectedReason);
  });

  it('classifies older and newer schemas separately', () => {
    const older = { ...validRawSnapshot(), schemaVersion: 0 };
    const newer = { ...validRawSnapshot(), schemaVersion: 2, futureField: true };

    expect(deserializeControllerSettingsSnapshot(JSON.stringify(older))).toEqual({
      kind: 'schema-too-old',
      sawVersion: 0,
    });
    expect(deserializeControllerSettingsSnapshot(JSON.stringify(newer))).toEqual({
      kind: 'schema-too-new',
      sawVersion: 2,
    });
  });

  it.each([
    [
      'duplicate ids',
      [
        { id: 110, rawValue: '1' },
        { id: 110, rawValue: '2' },
      ],
      'duplicate',
    ],
    ['negative id', [{ id: -1, rawValue: '1' }], 'non-negative integer'],
    ['fractional id', [{ id: 110.5, rawValue: '1' }], 'non-negative integer'],
    ['non-string raw value', [{ id: 110, rawValue: 6000 }], 'rawValue must be a string'],
    ['extra setting field', [{ id: 110, rawValue: '1', command: '$110=1' }], 'unexpected'],
  ])('rejects unsafe setting records: %s', (_name, settings, expectedReason) => {
    const result = deserializeControllerSettingsSnapshot(
      JSON.stringify({ ...validRawSnapshot(), settings }),
    );
    expect(result).toMatchObject({ kind: 'invalid' });
    if (result.kind === 'invalid') expect(result.reason).toContain(expectedReason);
  });

  it('rejects malformed JSON and runtime-invalid objects passed to the serializer', () => {
    expect(deserializeControllerSettingsSnapshot('{oops')).toMatchObject({
      kind: 'invalid',
      reason: expect.stringContaining('not valid JSON'),
    });
    expect(() =>
      serializeControllerSettingsSnapshot({
        ...(validRawSnapshot() as unknown as ControllerSettingsSnapshot),
        operatorLabel: '',
      }),
    ).toThrow('Invalid controller settings snapshot');
  });
});
