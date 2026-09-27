import { describe, expect, it } from 'vitest';
import { calculateFeeds } from './feeds-calculator';
import { nominalChiploadMm } from './nominal-chipload';

describe('programmed nominal chipload', () => {
  it('reports the limited value instead of labelling the chart target as achieved', () => {
    const result = calculateFeeds({
      material: 'hardwood',
      bitDiameterMm: 6.35,
      flutes: 2,
      rpm: 18000,
      maxFeedMmPerMin: 1000,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error(result.reason);
    expect(result.chiploadMm).toBe(0.1);
    expect(nominalChiploadMm(result.feedMmPerMin, 18000, 2)).toBeCloseTo(0.0277777778, 9);
  });
  it('accounts for emitted integer words and refuses an unavailable denominator', () => {
    expect(nominalChiploadMm(999.6, 11999.6, 2)).toBe(999 / 24000);
    expect(nominalChiploadMm(1.9, 12000, 2)).toBe(1 / 24000);
    expect(nominalChiploadMm(0.5, 12000, 2)).toBe(0.5 / 24000);
    for (const rpm of [0, NaN, Infinity, 0.1]) expect(nominalChiploadMm(1000, rpm, 2)).toBeNull();
  });
});
