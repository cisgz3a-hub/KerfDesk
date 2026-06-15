import { describe, expect, it } from 'vitest';
import { createGrblSettingsBackup, settingsMapToRows } from './grbl-settings';

describe('settingsMapToRows', () => {
  it('maps known GRBL laser settings to named rows', () => {
    const rows = settingsMapToRows(
      new Map<number, string>([
        [30, '1000'],
        [31, '0'],
        [32, '1'],
      ]),
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: 30,
        code: '$30',
        rawValue: '1000',
        numericValue: 1000,
        name: expect.stringMatching(/max/i),
        category: 'laser',
        known: true,
      }),
      expect.objectContaining({
        id: 31,
        code: '$31',
        rawValue: '0',
        numericValue: 0,
        name: expect.stringMatching(/min/i),
        category: 'laser',
        known: true,
      }),
      expect.objectContaining({
        id: 32,
        code: '$32',
        rawValue: '1',
        numericValue: 1,
        name: expect.stringMatching(/laser mode/i),
        category: 'laser',
        known: true,
      }),
    ]);
  });

  it('preserves unknown settings as visible rows', () => {
    const rows = settingsMapToRows(new Map([[999, 'abc']]));

    expect(rows).toEqual([
      expect.objectContaining({
        id: 999,
        code: '$999',
        rawValue: 'abc',
        numericValue: null,
        name: 'Unknown GRBL setting',
        category: 'unknown',
        known: false,
        writeRisk: 'unknown',
      }),
    ]);
  });

  it('sorts rows by numeric setting id', () => {
    const rows = settingsMapToRows(
      new Map<number, string>([
        [130, '400'],
        [30, '1000'],
        [0, '10'],
      ]),
    );

    expect(rows.map((row) => row.code)).toEqual(['$0', '$30', '$130']);
  });

  it('keeps non-numeric values visible without numericValue', () => {
    const rows = settingsMapToRows(new Map([[30, 'not-a-number']]));

    expect(rows[0]).toMatchObject({
      code: '$30',
      rawValue: 'not-a-number',
      numericValue: null,
      known: true,
    });
  });
});

describe('createGrblSettingsBackup', () => {
  it('creates deterministic backup data with every row', () => {
    const rows = settingsMapToRows(
      new Map<number, string>([
        [30, '1000'],
        [999, 'abc'],
      ]),
    );

    const backup = createGrblSettingsBackup(rows, '2026-06-15T09:00:00.000Z');

    expect(backup).toEqual({
      format: 'laserforge.grbl-settings.backup',
      version: 1,
      createdAt: '2026-06-15T09:00:00.000Z',
      settings: rows,
    });
  });
});
