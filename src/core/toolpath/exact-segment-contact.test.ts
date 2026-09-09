import { describe, expect, it } from 'vitest';
import { exactSegmentContact } from './exact-segment-contact';

describe('exactSegmentContact', () => {
  it('distinguishes incidence from a one-ulp gap', () => {
    const start = { x: 0, y: 0 },
      end = { x: 1, y: 1 };
    expect(exactSegmentContact({ x: 0.5, y: 0.5 }, start, end)).toBe(true);
    expect(exactSegmentContact({ x: 0.5, y: 0.5 + Number.EPSILON }, start, end)).toBe(false);
  });

  it('does not mistake underflowing products for collinearity', () => {
    expect(
      exactSegmentContact({ x: 5e-301, y: 5.1e-301 }, { x: 0, y: 0 }, { x: 1e-300, y: 1e-300 }),
    ).toBe(false);
    expect(
      exactSegmentContact({ x: 5e-301, y: 5e-301 }, { x: 0, y: 0 }, { x: 1e-300, y: 1e-300 }),
    ).toBe(true);
  });

  it('recognises collinearity when ordinary subtraction or products overflow', () => {
    expect(
      exactSegmentContact({ x: 0, y: 0 }, { x: -1e308, y: -1e308 }, { x: 1e308, y: 1e308 }),
    ).toBe(true);
    expect(
      exactSegmentContact({ x: 0, y: 1 }, { x: -1e308, y: -1e308 }, { x: 1e308, y: 1e308 }),
    ).toBe(false);
  });

  it('handles subnormal coordinates and exact zero-length contacts', () => {
    const tiny = Number.MIN_VALUE;
    expect(
      exactSegmentContact({ x: tiny, y: tiny }, { x: 0, y: 0 }, { x: tiny * 2, y: tiny * 2 }),
    ).toBe(true);
    expect(
      exactSegmentContact({ x: tiny, y: 0 }, { x: 0, y: 0 }, { x: tiny * 2, y: tiny * 2 }),
    ).toBe(false);
    expect(exactSegmentContact({ x: -0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(exactSegmentContact({ x: tiny, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it('rejects line extensions and nonfinite coordinates as contacts', () => {
    expect(exactSegmentContact({ x: 2, y: 2 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
    expect(exactSegmentContact({ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toBe(false);
  });
});
