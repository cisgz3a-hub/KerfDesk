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

  // Rounding up turned the 5% ceiling into S13 of S255, 5.1% (controller
  // audit P-2), so S rounds down to stay at or below the cap.
  it('never rounds S above the capped share of full power', () => {
    const atCeiling = { enabled: true, maxPowerPercent: HARD_MAX_FIRE_POWER_PERCENT } as const;
    expect(cappedFirePowerS(5, atCeiling, 255)).toBe(12);
    expect(cappedFirePowerS(1, atCeiling, 255)).toBe(2);
    expect(cappedFirePowerS(0.3, atCeiling, 100)).toBe(0);
    // Exact shares survive binary float error: 0.57 * 10000 / 100 is 56.99...
    expect(cappedFirePowerS(0.57, atCeiling, 10000)).toBe(57);
    expect(cappedFirePowerS(5, atCeiling, 1000)).toBe(50);
  });
});
