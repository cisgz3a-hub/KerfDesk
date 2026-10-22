import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { FALCON_A1_PRO_BLUE_20W_MODULE, FALCON_A1_PRO_INFRARED_2W_MODULE } from './laser-modules';
import {
  devicePositioningLightIssue,
  LASER_DOT_LIGHT,
  laserDotModuleIssue,
  normalizePositioningLight,
  POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
  positioningLightIssue,
} from './positioning-light';

describe('Falcon A1 Pro laser dot (ADR-664)', () => {
  it('needs no commands, only a capped power', () => {
    expect(LASER_DOT_LIGHT.powerPercent).toBe(1);
    expect(positioningLightIssue(LASER_DOT_LIGHT, 'grblhal')).toBeNull();
    expect(positioningLightIssue({ ...LASER_DOT_LIGHT, powerPercent: 5 }, 'grblhal')).toBeNull();
    for (const powerPercent of [0, -1, 5.01, Number.NaN, '1'])
      expect(positioningLightIssue({ ...LASER_DOT_LIGHT, powerPercent }, 'grblhal')).toBe(
        'Laser dot power must be above 0% and no more than 5%.',
      );
    expect(positioningLightIssue({ ...LASER_DOT_LIGHT, afterFrame: 'yes' }, 'grblhal')).toContain(
      'after Frame',
    );
    expect(positioningLightIssue({ ...LASER_DOT_LIGHT, kind: 'laser' }, 'grblhal')).toBe(
      'Positioning light type is not one KerfDesk knows.',
    );
  });

  it('is the laser spot, so it has no offset', () => {
    expect(positioningLightIssue({ ...LASER_DOT_LIGHT, offsetXmm: 2 }, 'grblhal')).toBe(
      'The laser dot is the laser spot, so its offsets must be 0.',
    );
  });

  it('refuses the retired network red pointer instead of firing the laser for it', () => {
    const retired = { kind: 'creality-falcon-pointer', offsetXmm: 0, offsetYmm: 0 };
    expect(positioningLightIssue(retired, 'grblhal')).toContain('switched the wrong light');
    expect(normalizePositioningLight(retired, 'grblhal')).toBeUndefined();
  });

  it('is never allowed on a Marlin fan-mosfet profile', () => {
    expect(positioningLightIssue(LASER_DOT_LIGHT, 'marlin', 'marlin-fan')).toBe(
      POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
    );
  });

  it('works only on the Falcon A1 Pro command set', () => {
    const dot = { positioningLight: LASER_DOT_LIGHT };
    expect(devicePositioningLightIssue({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, ...dot })).toBeNull();
    for (const profile of [FALCON_COMPATIBLE_PROFILE, DEFAULT_DEVICE_PROFILE])
      expect(devicePositioningLightIssue({ ...profile, ...dot })).toBe(
        'The laser dot needs the Creality Falcon A1 Pro machine profile.',
      );
  });

  it('needs a visible beam: the infrared module would show nothing', () => {
    expect(laserDotModuleIssue({ laserSubProfile: FALCON_A1_PRO_BLUE_20W_MODULE })).toBeNull();
    expect(laserDotModuleIssue({})).toBeNull();
    expect(laserDotModuleIssue({ laserSubProfile: FALCON_A1_PRO_INFRARED_2W_MODULE })).toContain(
      '1064 nm beam is invisible',
    );
  });

  it('normalizes to its own fields, keeping After Frame only when on', () => {
    expect(
      normalizePositioningLight(
        { ...LASER_DOT_LIGHT, powerPercent: 2, afterFrame: true, onCommand: 'M8' },
        'grblhal',
      ),
    ).toEqual({ ...LASER_DOT_LIGHT, powerPercent: 2, afterFrame: true });
    expect(normalizePositioningLight({ ...LASER_DOT_LIGHT, afterFrame: false })).toEqual(
      LASER_DOT_LIGHT,
    );
  });
});
