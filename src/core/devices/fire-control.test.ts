import { describe, expect, it } from 'vitest';
import {
  cappedFirePowerS,
  HARD_MAX_FIRE_POWER_PERCENT,
  normalizeLaserFireControl,
} from './fire-control';

describe('laser Fire control policy', () => {
  it('normalizes only explicit settings within the hard cap', () => {
    expect(normalizeLaserFireControl({ enabled: true, maxPowerPercent: 1 })).toEqual({
      enabled: true,
      maxPowerPercent: 1,
    });
    expect(
      normalizeLaserFireControl({
        enabled: true,
        maxPowerPercent: HARD_MAX_FIRE_POWER_PERCENT + 1,
      }),
    ).toBeUndefined();
    expect(normalizeLaserFireControl({ enabled: 'yes', maxPowerPercent: 1 })).toBeUndefined();
  });

  it('caps requested S independently of the caller value', () => {
    const control = { enabled: true, maxPowerPercent: 2 } as const;
    expect(cappedFirePowerS(1, control, 1000)).toBe(10);
    expect(cappedFirePowerS(50, control, 1000)).toBe(20);
    expect(cappedFirePowerS(-1, control, 1000)).toBe(0);
  });
});
