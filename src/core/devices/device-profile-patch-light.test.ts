import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { deviceProfileWithInteractivePatch } from './device-profile-patch';

const light = { onCommand: 'M355 S1', offCommand: 'M355 S0', offsetXmm: 0, offsetYmm: 0 };
const marlin = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin' as const,
  gcodeDialect: { dialectId: 'marlin-inline' as const },
  positioningLight: light,
};

describe('positioning light on a dialect switch', () => {
  it('removes the light when a profile switches to the Marlin fan-mosfet dialect', () => {
    const next = deviceProfileWithInteractivePatch(marlin, {
      gcodeDialect: { dialectId: 'marlin-fan' },
    });
    expect(next.gcodeDialect.dialectId).toBe('marlin-fan');
    expect(next.positioningLight).toBeUndefined();
    expect('positioningLight' in next).toBe(false);
  });

  it('never lets an edit add a light to a Marlin fan-mosfet profile', () => {
    const fan = deviceProfileWithInteractivePatch(marlin, {
      gcodeDialect: { dialectId: 'marlin-fan' },
    });
    expect(
      deviceProfileWithInteractivePatch(fan, { positioningLight: light }).positioningLight,
    ).toBeUndefined();
  });

  it('keeps the light on every other dialect edit', () => {
    expect(deviceProfileWithInteractivePatch(marlin, { name: 'Renamed' }).positioningLight).toEqual(
      light,
    );
  });
});
