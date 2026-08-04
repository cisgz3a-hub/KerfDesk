import { describe, expect, it } from 'vitest';
import { isValidCncTipDiameterMm } from './cnc-tip-diameter';

describe('isValidCncTipDiameterMm', () => {
  it.each([0, 0.2, 0.999])('accepts a finite flat tip smaller than the cutter: %s', (value) => {
    expect(isValidCncTipDiameterMm(value, 1)).toBe(true);
  });

  it.each([undefined, -0.1, 1, 2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an absent or impossible flat tip: %s',
    (value) => {
      expect(isValidCncTipDiameterMm(value, 1)).toBe(false);
    },
  );
});
