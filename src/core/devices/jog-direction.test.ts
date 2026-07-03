import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from './device-profile';
import { jogAxisSignsForOrigin } from './jog-direction';
import { toMachineCoords } from './origin-transform';

const ALL_ORIGINS: ReadonlyArray<Origin> = [
  'front-left',
  'front-right',
  'rear-left',
  'rear-right',
  'center',
];

function deviceWithOrigin(origin: Origin): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, origin };
}

// The invariant that matters: the jog pad and the G-code emission mapping
// must agree on physical directions. Scene +X is the operator's right and
// scene -Y (canvas up) is away from the operator, so each sign must equal
// the corresponding component of origin-transform's linear part.
describe('jogAxisSignsForOrigin', () => {
  it.each(ALL_ORIGINS)('matches the origin-transform linear part for %s', (origin) => {
    const device = deviceWithOrigin(origin);
    const signs = jogAxisSignsForOrigin(origin);

    const base = toMachineCoords({ x: 10, y: 10 }, device);
    const sceneRight = toMachineCoords({ x: 11, y: 10 }, device);
    const sceneUp = toMachineCoords({ x: 10, y: 9 }, device);

    expect(signs.x).toBe(Math.sign(sceneRight.x - base.x));
    expect(signs.y).toBe(Math.sign(sceneUp.y - base.y));
  });
});
