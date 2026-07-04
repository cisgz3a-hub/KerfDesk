import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from './grbl-settings';
import { buildGrblSettingWrite } from './grbl-setting-write';

const rows = settingsMapToRows(
  new Map<number, string>([
    [30, '1000'],
    [31, '0'],
    [32, '1'],
    [100, '80'],
    [999, 'abc'],
  ]),
);

describe('guarded GRBL setting writes', () => {
  it('allows common laser settings with checkbox confirmation and a current backup', () => {
    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: '1',
        confirmation: { commonSettingChecked: true },
        backupFresh: true,
      }),
    ).toEqual({ kind: 'ok', command: '$32=1' });
  });

  it('requires typed exact command confirmation for machine-critical settings', () => {
    const missing = buildGrblSettingWrite({
      rows,
      id: 100,
      value: '80',
      confirmation: { typedCommand: '$100 = 80' },
      backupFresh: true,
    });
    const ok = buildGrblSettingWrite({
      rows,
      id: 100,
      value: '80',
      confirmation: { typedCommand: '$100=80' },
      backupFresh: true,
    });

    expect(missing.kind).toBe('blocked');
    expect(ok).toEqual({ kind: 'ok', command: '$100=80' });
  });

  it('blocks unknown settings, invalid values, and stale backups', () => {
    expect(
      buildGrblSettingWrite({
        rows,
        id: 999,
        value: '1',
        confirmation: { typedCommand: '$999=1' },
        backupFresh: true,
      }).kind,
    ).toBe('blocked');
    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: 'not-a-number',
        confirmation: { commonSettingChecked: true },
        backupFresh: true,
      }).kind,
    ).toBe('blocked');
    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: '1',
        confirmation: { commonSettingChecked: true },
        backupFresh: false,
      }).kind,
    ).toBe('blocked');
  });

  it('blocks non-canonical JavaScript numeric strings before firmware writes', () => {
    for (const value of ['1e3', '0x10', '+10', '1.', '.5']) {
      expect(
        buildGrblSettingWrite({
          rows,
          id: 30,
          value,
          confirmation: { commonSettingChecked: true },
          backupFresh: true,
        }),
      ).toEqual({ kind: 'blocked', reason: '$30 value is not valid for a guarded GRBL write.' });
    }

    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: '1.0',
        confirmation: { commonSettingChecked: true },
        backupFresh: true,
      }),
    ).toEqual({ kind: 'blocked', reason: '$32 value is not valid for a guarded GRBL write.' });
  });
});
