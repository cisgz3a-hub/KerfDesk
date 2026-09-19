import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG, LASER_MACHINE_CONFIG } from '../../../core/scene';
import { settingsMapToRows, type GrblSettingRow } from '../../../core/controllers/grbl';
import { computeFirmwareComparison, computeFirmwareDiffs } from './device-setup-firmware-diff';

function rows(values: Record<number, string>): ReadonlyArray<GrblSettingRow> {
  const entries = Object.entries(values).map(
    ([id, value]) => [Number(id), value] as [number, string],
  );
  return settingsMapToRows(new Map(entries));
}

describe('computeFirmwareDiffs', () => {
  it('returns nothing when no settings were read', () => {
    expect(computeFirmwareDiffs(DEFAULT_DEVICE_PROFILE, [])).toEqual([]);
  });

  it('marks matching settings as not differing and $30 as writable', () => {
    const draft = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000, laserModeEnabled: true };
    const diffs = computeFirmwareDiffs(draft, rows({ 30: '1000', 32: '1' }), {
      machineKinds: ['laser'],
    });
    const d30 = diffs.find((diff) => diff.id === 30);
    expect(d30?.differs).toBe(false);
    expect(d30?.writable).toBe(true);
    expect(d30?.label).toBe('Laser S maximum');
  });

  it('flags a writable mismatch on $30 with current and desired values', () => {
    const draft = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 };
    const diffs = computeFirmwareDiffs(draft, rows({ 30: '255' }));
    const d30 = diffs.find((diff) => diff.id === 30);
    expect(d30?.differs).toBe(true);
    expect(d30?.writable).toBe(true);
    expect(d30?.current).toBe('255');
    expect(d30?.desired).toBe('1000');
  });

  it('surfaces a bed-travel mismatch read-only (machine-critical, not writable here)', () => {
    const draft = { ...DEFAULT_DEVICE_PROFILE, bedWidth: 400 };
    const d130 = computeFirmwareDiffs(draft, rows({ 130: '500' })).find((diff) => diff.id === 130);
    expect(d130?.differs).toBe(true);
    expect(d130?.writable).toBe(false);
  });

  it('treats $32 laser mode as a 0/1 desired value', () => {
    const draft = { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: false };
    const d32 = computeFirmwareDiffs(draft, rows({ 32: '1' })).find((diff) => diff.id === 32);
    expect(d32?.differs).toBe(true);
    expect(d32?.desired).toBe('0');
  });

  it('treats every common laser setting ($30/$31/$32) as writable', () => {
    const diffs = computeFirmwareDiffs(
      DEFAULT_DEVICE_PROFILE,
      rows({ 30: '1000', 31: '0', 32: '1' }),
      { machineKinds: ['laser'] },
    );
    for (const id of [30, 31, 32]) {
      expect(diffs.find((diff) => diff.id === id)?.writable).toBe(true);
    }
  });

  describe('cnc machines', () => {
    // On a router setup the wizard must never offer the laser defaults:
    // $32 desired is 0 (router mode) and $30 desired is the spindle max
    // RPM — regardless of what the (laser-oriented) device profile says.
    it('accepts a router-correct controller ($32=0, $30=spindle RPM) as not differing', () => {
      const diffs = computeFirmwareDiffs(
        { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: true, maxPowerS: 1000 },
        rows({ 30: '12000', 32: '0' }),
        { machine: DEFAULT_CNC_MACHINE_CONFIG, machineKinds: ['cnc'] },
      );
      expect(diffs.find((diff) => diff.id === 32)?.differs).toBe(false);
      expect(diffs.find((diff) => diff.id === 30)?.differs).toBe(false);
    });

    it('flags $32=1 on a router with desired 0, never offering $32=1', () => {
      const diffs = computeFirmwareDiffs(
        { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: true },
        rows({ 32: '1' }),
        { machine: DEFAULT_CNC_MACHINE_CONFIG, machineKinds: ['cnc'] },
      );
      const d32 = diffs.find((diff) => diff.id === 32);
      expect(d32?.differs).toBe(true);
      expect(d32?.desired).toBe('0');
      expect(d32?.label).toBe('Spindle output mode');
    });

    it('flags a laser-scale $30 on a router with the spindle RPM as desired', () => {
      const d30 = computeFirmwareDiffs(
        { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 },
        rows({ 30: '1000' }),
        { machine: DEFAULT_CNC_MACHINE_CONFIG, machineKinds: ['cnc'] },
      ).find((diff) => diff.id === 30);
      expect(d30?.differs).toBe(true);
      expect(d30?.desired).toBe('12000');
      expect(d30?.label).toBe('Maximum spindle speed');
    });

    it('does not borrow the laser-only $31 profile value for CNC', () => {
      const diffs = computeFirmwareDiffs(
        { ...DEFAULT_DEVICE_PROFILE, minPowerS: 7 },
        rows({ 30: '1000', 31: '0', 32: '1' }),
        { machine: DEFAULT_CNC_MACHINE_CONFIG, machineKinds: ['cnc'] },
      );

      expect(diffs.some((diff) => diff.id === 31)).toBe(false);
    });
  });

  it('labels hybrid settings with both meanings and the active contract first', () => {
    const laserDiff = computeFirmwareDiffs(DEFAULT_DEVICE_PROFILE, rows({ 30: '900' }), {
      machine: LASER_MACHINE_CONFIG,
      machineKinds: ['laser', 'cnc'],
    }).find((diff) => diff.id === 30);
    const cncDiff = computeFirmwareDiffs(DEFAULT_DEVICE_PROFILE, rows({ 30: '900' }), {
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      machineKinds: ['laser', 'cnc'],
    }).find((diff) => diff.id === 30);

    expect(laserDiff?.label).toBe('Laser S maximum / spindle maximum');
    expect(cncDiff?.label).toBe('Spindle maximum / laser S maximum');
  });
});

describe('computeFirmwareComparison evidence coverage', () => {
  it.each([{}, { 999: 'vendor-only' }])('keeps missing settings explicit for %j', (values) => {
    expect(computeFirmwareComparison(DEFAULT_DEVICE_PROFILE, rows(values))).toEqual({
      diffs: [],
      expectedCount: 5,
      comparedCount: 0,
      missingCodes: ['$30', '$31', '$32', '$130', '$131'],
      invalidCodes: [],
    });
  });

  it.each(['corrupt', 'Infinity', ''])('does not compare invalid readback %j', (value) => {
    const result = computeFirmwareComparison(DEFAULT_DEVICE_PROFILE, rows({ 30: value }));
    expect(result.comparedCount).toBe(0);
    expect(result.invalidCodes).toEqual(['$30']);
    expect(result.missingCodes).toEqual(['$31', '$32', '$130', '$131']);
    expect(result.diffs[0]).toMatchObject({
      current: value,
      comparison: 'invalid',
      differs: false,
    });
  });

  it('distinguishes a match, a numeric difference, invalid readback and missing evidence', () => {
    const result = computeFirmwareComparison(
      DEFAULT_DEVICE_PROFILE,
      rows({ 30: '255', 31: 'corrupt', 32: DEFAULT_DEVICE_PROFILE.laserModeEnabled ? '1' : '0' }),
    );
    expect(result).toMatchObject({
      expectedCount: 5,
      comparedCount: 2,
      invalidCodes: ['$31'],
      missingCodes: ['$130', '$131'],
    });
    expect(result.diffs.map((diff) => [diff.code, diff.comparison])).toEqual([
      ['$30', 'different'],
      ['$31', 'invalid'],
      ['$32', 'match'],
    ]);
    expect(
      result.diffs.filter((diff) => diff.differs && diff.writable).map((diff) => diff.code),
    ).toEqual(['$30']);
  });

  it('counts every expected laser value in a complete matching readback', () => {
    const draft = DEFAULT_DEVICE_PROFILE;
    const result = computeFirmwareComparison(
      draft,
      rows({
        30: String(draft.maxPowerS),
        31: String(draft.minPowerS),
        32: draft.laserModeEnabled ? '1' : '0',
        130: String(draft.bedWidth),
        131: String(draft.bedHeight),
      }),
    );
    expect(result).toMatchObject({
      expectedCount: 5,
      comparedCount: 5,
      missingCodes: [],
      invalidCodes: [],
    });
    expect(result.diffs.every((diff) => diff.comparison === 'match')).toBe(true);
  });

  it('counts only the four defined CNC profile settings and does not require laser $31', () => {
    const result = computeFirmwareComparison(
      DEFAULT_DEVICE_PROFILE,
      rows({
        30: String(DEFAULT_CNC_MACHINE_CONFIG.params.spindleMaxRpm),
        32: '0',
        130: String(DEFAULT_DEVICE_PROFILE.bedWidth),
        131: String(DEFAULT_DEVICE_PROFILE.bedHeight),
      }),
      { machine: DEFAULT_CNC_MACHINE_CONFIG, machineKinds: ['cnc'] },
    );
    expect(result).toMatchObject({
      expectedCount: 4,
      comparedCount: 4,
      missingCodes: [],
      invalidCodes: [],
    });
    expect(result.diffs.every((diff) => diff.comparison === 'match')).toBe(true);
  });
});
