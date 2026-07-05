import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { settingsMapToRows, type GrblSettingRow } from '../../../core/controllers/grbl';
import { computeFirmwareDiffs } from './device-setup-firmware-diff';

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
    const diffs = computeFirmwareDiffs(draft, rows({ 30: '1000', 32: '1' }));
    const d30 = diffs.find((diff) => diff.id === 30);
    expect(d30?.differs).toBe(false);
    expect(d30?.writable).toBe(true);
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
        DEFAULT_CNC_MACHINE_CONFIG,
      );
      expect(diffs.find((diff) => diff.id === 32)?.differs).toBe(false);
      expect(diffs.find((diff) => diff.id === 30)?.differs).toBe(false);
    });

    it('flags $32=1 on a router with desired 0, never offering $32=1', () => {
      const diffs = computeFirmwareDiffs(
        { ...DEFAULT_DEVICE_PROFILE, laserModeEnabled: true },
        rows({ 32: '1' }),
        DEFAULT_CNC_MACHINE_CONFIG,
      );
      const d32 = diffs.find((diff) => diff.id === 32);
      expect(d32?.differs).toBe(true);
      expect(d32?.desired).toBe('0');
    });

    it('flags a laser-scale $30 on a router with the spindle RPM as desired', () => {
      const d30 = computeFirmwareDiffs(
        { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 },
        rows({ 30: '1000' }),
        DEFAULT_CNC_MACHINE_CONFIG,
      ).find((diff) => diff.id === 30);
      expect(d30?.differs).toBe(true);
      expect(d30?.desired).toBe('12000');
    });
  });
});
