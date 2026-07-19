import { describe, expect, it } from 'vitest';
import { settingsMapToRows, type GrblSettingRow } from '../../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { buildSuperConsoleSettingsDiagnostics } from './super-console-settings-diagnostics';

function rows(values: Record<number, string>): ReadonlyArray<GrblSettingRow> {
  return settingsMapToRows(
    new Map(Object.entries(values).map(([id, value]) => [Number(id), value])),
  );
}

describe('buildSuperConsoleSettingsDiagnostics', () => {
  it('returns nothing before a controller settings snapshot exists', () => {
    expect(buildSuperConsoleSettingsDiagnostics(DEFAULT_DEVICE_PROFILE, [])).toEqual([]);
  });

  it('uses the established laser output contract for $30/$31/$32', () => {
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      DEFAULT_DEVICE_PROFILE,
      rows({ 30: '1000', 31: '1', 32: '1' }),
      { machineKinds: ['laser'] },
    );

    expect(diagnostics.slice(0, 3)).toMatchObject([
      {
        id: 30,
        label: 'Laser S maximum',
        comparisonKind: 'output-contract',
        status: 'matches-contract',
        reference: '1000',
      },
      {
        id: 31,
        comparisonKind: 'output-contract',
        status: 'differs-from-contract',
        reference: '0',
      },
      {
        id: 32,
        comparisonKind: 'output-contract',
        status: 'matches-contract',
        reference: '1',
      },
    ]);
  });

  it('does not invent a laser minimum contract for an active CNC machine', () => {
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      DEFAULT_DEVICE_PROFILE,
      rows({ 30: '12000', 31: '0', 32: '0' }),
      { machine: DEFAULT_CNC_MACHINE_CONFIG, machineKinds: ['cnc'] },
    );

    expect(diagnostics.find((item) => item.id === 30)).toMatchObject({
      label: 'Maximum spindle speed',
      status: 'matches-contract',
      reference: '12000',
    });
    expect(diagnostics.find((item) => item.id === 31)).toMatchObject({
      comparisonKind: 'live-only',
      status: 'live-only',
      reference: null,
    });
  });

  it('keeps axis calibration live-only because the profile has no calibration target', () => {
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      DEFAULT_DEVICE_PROFILE,
      rows({ 100: '80.000', 101: '79.950' }),
    );

    expect(diagnostics).toMatchObject([
      { id: 100, comparisonKind: 'live-only', status: 'live-only', reference: null },
      { id: 101, comparisonKind: 'live-only', status: 'live-only', reference: null },
    ]);
  });

  it('compares per-axis firmware rate ceilings with the shared app command cap', () => {
    const profile = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000 };
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      profile,
      rows({ 110: '6000', 111: '3000' }),
    );

    expect(diagnostics).toMatchObject([
      {
        id: 110,
        comparisonKind: 'command-cap-reference',
        status: 'same-as-reference',
        reference: '6000',
      },
      {
        id: 111,
        comparisonKind: 'command-cap-reference',
        status: 'different-from-reference',
        reference: '6000',
      },
    ]);
    expect(diagnostics[1]?.note).toContain('serve different roles');
  });

  it('compares per-axis acceleration and junction deviation with ETA references', () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      accelMmPerSec2: 250,
      junctionDeviationMm: 0.02,
    };
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      profile,
      rows({ 120: '250', 121: '500', 11: '0.020' }),
    );

    expect(diagnostics).toMatchObject([
      {
        id: 120,
        comparisonKind: 'planner-reference',
        status: 'same-as-reference',
        reference: '250',
      },
      {
        id: 121,
        comparisonKind: 'planner-reference',
        status: 'different-from-reference',
        reference: '250',
      },
      {
        id: 11,
        comparisonKind: 'planner-reference',
        status: 'same-as-reference',
        reference: '0.02',
      },
    ]);
  });

  it('surfaces limits, homing, and bed travel with their correct comparison semantics', () => {
    const profile = {
      ...DEFAULT_DEVICE_PROFILE,
      bedWidth: 400,
      bedHeight: 400,
      homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: true },
    };
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      profile,
      rows({ 20: '1', 21: '0', 22: '1', 130: '410', 131: '400' }),
    );

    expect(diagnostics).toMatchObject([
      { id: 20, comparisonKind: 'live-only', status: 'live-only' },
      { id: 21, comparisonKind: 'live-only', status: 'live-only' },
      { id: 22, comparisonKind: 'profile-reference', status: 'same-as-reference' },
      {
        id: 130,
        comparisonKind: 'profile-reference',
        status: 'different-from-reference',
      },
      { id: 131, comparisonKind: 'profile-reference', status: 'same-as-reference' },
    ]);
    expect(diagnostics.find((item) => item.id === 130)?.note).toContain('can legitimately differ');
  });

  it('marks non-numeric values as not comparable instead of treating them as matches', () => {
    const diagnostics = buildSuperConsoleSettingsDiagnostics(
      DEFAULT_DEVICE_PROFILE,
      rows({ 30: 'not-a-number', 120: 'unknown' }),
    );

    expect(diagnostics).toMatchObject([
      { id: 30, status: 'not-comparable' },
      { id: 120, status: 'not-comparable' },
    ]);
  });
});
