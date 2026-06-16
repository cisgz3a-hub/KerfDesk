import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { describePatch } from './DetectedSettingsBanner';

describe('describePatch', () => {
  it('surfaces GRBL $31 and $32 alongside $30 detected settings', () => {
    const rows = describePatch(
      { maxPowerS: 255, minPowerS: 10, laserModeEnabled: false },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(rows.map((r) => r.label)).toEqual([
      'Max power (S)',
      'Min power (S)',
      'Laser mode ($32)',
    ]);
    expect(rows[1]).toMatchObject({
      oldText: '0',
      newText: '10',
      changed: true,
    });
    expect(rows[2]).toMatchObject({
      oldText: 'Enabled',
      newText: 'Disabled',
      changed: true,
    });
  });

  it('surfaces detected Z max travel from GRBL $132', () => {
    const rows = describePatch({ zTravelMm: 75 }, DEFAULT_DEVICE_PROFILE);

    expect(rows).toEqual([
      expect.objectContaining({
        label: 'Z travel',
        oldText: 'Not set',
        newText: '75.000 mm',
        changed: true,
      }),
    ]);
  });
});
