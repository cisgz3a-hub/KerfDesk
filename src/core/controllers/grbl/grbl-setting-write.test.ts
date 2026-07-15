import { describe, expect, it } from 'vitest';
import { settingsMapToRows } from './grbl-settings';
import {
  buildGrblSettingWrite,
  grblSettingCommandMachineKindIssue,
  grblSettingMachineKindIssue,
} from './grbl-setting-write';

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
  it('blocks $32=0 for a laser while retaining laser-on and router-off writes', () => {
    expect(grblSettingMachineKindIssue('laser', 32, '0')).toContain(
      'Laser machine setup cannot write $32=0',
    );
    expect(grblSettingMachineKindIssue('laser', 32, '1')).toBeNull();
    expect(grblSettingMachineKindIssue('cnc', 32, '0')).toBeNull();
    expect(grblSettingCommandMachineKindIssue('laser', '$32=0.0')).toContain(
      'Laser machine setup cannot write $32=0',
    );
    expect(grblSettingCommandMachineKindIssue('cnc', '$32=0.0')).toBeNull();
    for (const command of ['$32=0.5', '$32=.5', '$32=1.0', '$32=2', '$32=256']) {
      expect(grblSettingCommandMachineKindIssue('laser', command)).toContain(
        'Laser machine setup cannot write $32=0',
      );
    }
    expect(grblSettingCommandMachineKindIssue('laser', '$32=1')).toBeNull();

    const confirmed = {
      rows,
      id: 32,
      confirmation: { commonSettingChecked: true },
      backupFresh: true,
    } as const;
    expect(buildGrblSettingWrite({ ...confirmed, machineKind: 'laser', value: '0' })).toEqual({
      kind: 'blocked',
      reason: expect.stringContaining('Laser machine setup cannot write $32=0'),
    });
    expect(buildGrblSettingWrite({ ...confirmed, machineKind: 'laser', value: '1' })).toEqual({
      kind: 'ok',
      command: '$32=1',
    });
    expect(buildGrblSettingWrite({ ...confirmed, machineKind: 'cnc', value: '0' })).toEqual({
      kind: 'ok',
      command: '$32=0',
    });
  });

  it('allows common laser settings with checkbox confirmation and a current backup', () => {
    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: '1',
        machineKind: 'laser',
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
      machineKind: 'laser',
      confirmation: { typedCommand: '$100 = 80' },
      backupFresh: true,
    });
    const ok = buildGrblSettingWrite({
      rows,
      id: 100,
      value: '80',
      machineKind: 'laser',
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
        machineKind: 'laser',
        confirmation: { typedCommand: '$999=1' },
        backupFresh: true,
      }).kind,
    ).toBe('blocked');
    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: 'not-a-number',
        machineKind: 'laser',
        confirmation: { commonSettingChecked: true },
        backupFresh: true,
      }).kind,
    ).toBe('blocked');
    expect(
      buildGrblSettingWrite({
        rows,
        id: 32,
        value: '1',
        machineKind: 'laser',
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
          machineKind: 'laser',
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
        machineKind: 'laser',
        confirmation: { commonSettingChecked: true },
        backupFresh: true,
      }),
    ).toEqual({ kind: 'blocked', reason: '$32 value is not valid for a guarded GRBL write.' });
  });
});
