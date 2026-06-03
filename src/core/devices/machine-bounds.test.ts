import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from './device-profile';
import { machineBoundsForDevice } from './machine-bounds';

describe('machineBoundsForDevice', () => {
  it('uses the positive machine rectangle for corner-origin devices', () => {
    expect(machineBoundsForDevice({ ...DEFAULT_DEVICE_PROFILE, origin: 'front-left' })).toEqual({
      width: 400,
      height: 400,
      minX: 0,
      minY: 0,
      maxX: 400,
      maxY: 400,
    });
  });

  it('uses a negative and positive rectangle for center-origin devices', () => {
    expect(machineBoundsForDevice({ ...DEFAULT_DEVICE_PROFILE, origin: 'center' })).toEqual({
      width: 400,
      height: 400,
      minX: -200,
      minY: -200,
      maxX: 200,
      maxY: 200,
    });
  });
});
