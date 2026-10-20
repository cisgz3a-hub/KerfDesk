import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import {
  devicePositioningLightIssue,
  FALCON_POINTER_LIGHT,
  normalizePositioningLight,
  POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
  positioningLightIssue,
} from './positioning-light';

describe('Falcon A1 Pro red pointer (ADR-635)', () => {
  it('needs no commands, only offsets', () => {
    expect(positioningLightIssue(FALCON_POINTER_LIGHT, 'grblhal')).toBeNull();
    expect(
      positioningLightIssue({ ...FALCON_POINTER_LIGHT, offsetXmm: 1001 }, 'grblhal'),
    ).toContain('X offset');
    expect(
      positioningLightIssue({ ...FALCON_POINTER_LIGHT, afterFrame: 'yes' }, 'grblhal'),
    ).toContain('after Frame');
    expect(positioningLightIssue({ ...FALCON_POINTER_LIGHT, kind: 'laser' }, 'grblhal')).toBe(
      'Positioning light type is not one KerfDesk knows.',
    );
  });

  it('is never allowed on a Marlin fan-mosfet profile', () => {
    expect(positioningLightIssue(FALCON_POINTER_LIGHT, 'marlin', 'marlin-fan')).toBe(
      POSITIONING_LIGHT_UNSUPPORTED_MESSAGE,
    );
  });

  it('works only on the Falcon A1 Pro command set', () => {
    const pointer = { positioningLight: FALCON_POINTER_LIGHT };
    expect(
      devicePositioningLightIssue({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, ...pointer }),
    ).toBeNull();
    for (const profile of [FALCON_COMPATIBLE_PROFILE, DEFAULT_DEVICE_PROFILE])
      expect(devicePositioningLightIssue({ ...profile, ...pointer })).toBe(
        'The Falcon red pointer needs the Creality Falcon A1 Pro machine profile.',
      );
  });

  it('normalizes to its own fields, keeping After Frame only when on', () => {
    expect(
      normalizePositioningLight(
        { ...FALCON_POINTER_LIGHT, offsetXmm: 2, afterFrame: true, onCommand: 'M8' },
        'grblhal',
      ),
    ).toEqual({ kind: 'creality-falcon-pointer', offsetXmm: 2, offsetYmm: 0, afterFrame: true });
    expect(normalizePositioningLight({ ...FALCON_POINTER_LIGHT, afterFrame: false })).toEqual(
      FALCON_POINTER_LIGHT,
    );
  });
});
