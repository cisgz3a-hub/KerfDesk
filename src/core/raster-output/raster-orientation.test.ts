import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { originFlipsRasterX, originFlipsRasterY } from './raster-orientation';

describe('raster orientation', () => {
  it.each([
    ['rear-left', false, false],
    ['rear-right', true, false],
    ['front-left', false, true],
    ['front-right', true, true],
    ['center', false, true],
  ] as const)('maps the %s device origin', (origin, flipX, flipY) => {
    const device = { ...DEFAULT_DEVICE_PROFILE, origin };
    expect(originFlipsRasterX(device)).toBe(flipX);
    expect(originFlipsRasterY(device)).toBe(flipY);
    const base = toMachineCoords({ x: 10, y: 10 }, device);
    const sceneRight = toMachineCoords({ x: 11, y: 10 }, device);
    const sceneDown = toMachineCoords({ x: 10, y: 11 }, device);
    expect(originFlipsRasterX(device)).toBe(sceneRight.x < base.x);
    expect(originFlipsRasterY(device)).toBe(sceneDown.y < base.y);
  });
});
