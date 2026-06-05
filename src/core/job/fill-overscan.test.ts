import { describe, expect, it } from 'vitest';
import { effectiveOverscanMm, expandFillHatchWithOverscan } from './fill-overscan';

describe('expandFillHatchWithOverscan', () => {
  it('adds horizontal lead-in and lead-out', () => {
    expect(
      expandFillHatchWithOverscan(
        [
          { x: 10, y: 5 },
          { x: 20, y: 5 },
        ],
        2,
      ),
    ).toEqual({
      leadStart: { x: 8, y: 5 },
      burnStart: { x: 10, y: 5 },
      burnEnd: { x: 20, y: 5 },
      leadEnd: { x: 22, y: 5 },
    });
  });

  it('adds diagonal lead-in and lead-out along the hatch vector', () => {
    const out = expandFillHatchWithOverscan(
      [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      5,
    );
    expect(out).toEqual({
      leadStart: { x: -3, y: -4 },
      burnStart: { x: 0, y: 0 },
      burnEnd: { x: 3, y: 4 },
      leadEnd: { x: 6, y: 8 },
    });
  });

  it('returns the burn endpoints when overscan is zero', () => {
    expect(
      expandFillHatchWithOverscan(
        [
          { x: 1, y: 2 },
          { x: 4, y: 2 },
        ],
        0,
      ),
    ).toEqual({
      leadStart: { x: 1, y: 2 },
      burnStart: { x: 1, y: 2 },
      burnEnd: { x: 4, y: 2 },
      leadEnd: { x: 4, y: 2 },
    });
  });

  it('returns null for malformed or zero-length hatches', () => {
    expect(expandFillHatchWithOverscan([{ x: 1, y: 1 }], 2)).toBeNull();
    expect(
      expandFillHatchWithOverscan(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        2,
      ),
    ).toBeNull();
  });
});

describe('effectiveOverscanMm', () => {
  const hatch = (len: number) => [
    { x: 0, y: 0 },
    { x: len, y: 0 },
  ];

  it('applies the configured overscan when the burn is at least 2x the per-side runway', () => {
    expect(effectiveOverscanMm(hatch(20), 5)).toBe(5);
    expect(effectiveOverscanMm(hatch(10), 5)).toBe(5); // exactly 2x -> applies
  });

  it('skips overscan (returns 0) when the burn is shorter than 2x the per-side runway', () => {
    expect(effectiveOverscanMm(hatch(9.99), 5)).toBe(0);
    expect(effectiveOverscanMm(hatch(3), 5)).toBe(0);
  });

  it('returns 0 when overscan is disabled or the geometry is degenerate', () => {
    expect(effectiveOverscanMm(hatch(20), 0)).toBe(0);
    expect(effectiveOverscanMm([{ x: 1, y: 1 }], 5)).toBe(0);
    expect(effectiveOverscanMm(hatch(0), 5)).toBe(0);
  });
});
