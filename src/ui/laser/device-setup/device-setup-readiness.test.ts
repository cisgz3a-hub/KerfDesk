import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_MACHINE_PROFILE_CATALOG,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../../../core/devices';
import { computeSetupReadiness } from './device-setup-readiness';

function nonDefaultPreset(): DeviceProfile {
  const preset = GRBL_MACHINE_PROFILE_CATALOG.find(
    (candidate) => candidate.profile.profileId !== DEFAULT_DEVICE_PROFILE.profileId,
  )?.profile;
  if (preset === undefined) throw new Error('catalog has no non-default preset');
  return preset;
}

describe('computeSetupReadiness', () => {
  it('flags the untouched generic default as not ready', () => {
    const readiness = computeSetupReadiness(DEFAULT_DEVICE_PROFILE, null);
    expect(readiness.ready).toBe(false);
    const blocking = readiness.items.filter((item) => item.blocking);
    expect(blocking.map((item) => item.id)).toEqual(['bed', 'power-scale']);
    expect(blocking.every((item) => item.status === 'needs-attention')).toBe(true);
    expect(readiness.items.find((item) => item.id === 'identity')).toMatchObject({
      blocking: false,
      status: 'confirmed',
      detail: DEFAULT_DEVICE_PROFILE.name,
    });
    expect(readiness.items.some((item) => item.id === 'origin' && !item.blocking)).toBe(true);
  });

  it('treats controller-reported bed and power as confirmed', () => {
    const readiness = computeSetupReadiness(DEFAULT_DEVICE_PROFILE, {
      bedWidth: 400,
      bedHeight: 400,
      maxPowerS: 1000,
    });
    expect(readiness.items.find((item) => item.id === 'bed')?.status).toBe('confirmed');
    expect(readiness.items.find((item) => item.id === 'power-scale')?.status).toBe('confirmed');
    expect(readiness.items.find((item) => item.id === 'identity')?.status).toBe('confirmed');
    expect(readiness.ready).toBe(true);
  });

  it('uses router spindle readiness without laser power or laser-head rows in CNC mode', () => {
    const readiness = computeSetupReadiness(
      DEFAULT_DEVICE_PROFILE,
      { bedWidth: 400, bedHeight: 400, maxPowerS: 24000 },
      'cnc',
    );
    expect(readiness.ready).toBe(true);
    expect(readiness.items.find((item) => item.id === 'spindle')).toMatchObject({
      status: 'confirmed',
      detail: '24000 RPM',
    });
    expect(readiness.items.some((item) => item.id === 'power-scale')).toBe(false);
    expect(readiness.items.some((item) => item.id === 'laser-head')).toBe(false);
  });

  it('is ready once a real catalog profile is chosen, even with default-matching numbers', () => {
    const readiness = computeSetupReadiness(nonDefaultPreset(), null);
    expect(readiness.ready).toBe(true);
    expect(
      readiness.items.filter((item) => item.blocking).every((item) => item.status === 'confirmed'),
    ).toBe(true);
  });

  it('warns without blocking when laser-head metadata is missing', () => {
    const readiness = computeSetupReadiness(
      {
        ...DEFAULT_DEVICE_PROFILE,
        profileId: 'shop-custom-400',
        name: 'Shop Custom 400',
      },
      null,
    );
    const laserHead = readiness.items.find((item) => item.id === 'laser-head');

    expect(readiness.ready).toBe(true);
    expect(laserHead).toMatchObject({
      label: 'Laser head',
      blocking: false,
      status: 'needs-attention',
    });
    expect(laserHead?.detail).toMatch(/generic recipes/i);
  });

  it('confirms laser-head metadata when power, wavelength, and technology are known', () => {
    const readiness = computeSetupReadiness(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, null);
    const laserHead = readiness.items.find((item) => item.id === 'laser-head');

    expect(laserHead).toMatchObject({
      label: 'Laser head',
      blocking: false,
      status: 'confirmed',
    });
    expect(laserHead?.detail).toMatch(/diode/i);
    expect(laserHead?.detail).toMatch(/w/i);
    expect(laserHead?.detail).toMatch(/nm/i);
  });

  it('confirms identity when the operator renames the generic profile', () => {
    const renamed: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, name: 'Shopfloor 4040' };
    expect(
      computeSetupReadiness(renamed, null).items.find((item) => item.id === 'identity'),
    ).toMatchObject({
      blocking: false,
      detail: 'Shopfloor 4040',
      status: 'confirmed',
    });
  });

  it('surfaces origin and homing as non-blocking review rows with readable detail', () => {
    const profile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      origin: 'rear-left',
      homing: { enabled: true, direction: 'rear-left' },
    };
    const items = computeSetupReadiness(profile, null).items;
    const origin = items.find((item) => item.id === 'origin');
    const homing = items.find((item) => item.id === 'homing');
    expect(origin?.blocking).toBe(false);
    expect(origin?.detail).toBe('Rear left');
    expect(homing?.blocking).toBe(false);
    expect(homing?.detail).toContain('Enabled');
    expect(homing?.detail).toContain('Rear left');
  });
});
