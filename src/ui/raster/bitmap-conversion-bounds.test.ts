import { describe, expect, it } from 'vitest';
import { bitmapConversionBounds } from './bitmap-conversion-bounds';

describe('bitmap physical footprint', () => {
  it('preserves nondegenerate artwork exactly', () => {
    const bounds = { minX: -12.34567, minY: 5.4321, maxX: 8.9, maxY: 7.65 };
    expect(bitmapConversionBounds(bounds, 25)).toBe(bounds);
  });

  it.each([5, 10, 25])('expands a point around its original position at %i lines/mm', (density) => {
    const bounds = bitmapConversionBounds({ minX: 2, minY: -3, maxX: 2, maxY: -3 }, density);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(1 / density);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(1 / density);
    expect((bounds.maxX + bounds.minX) / 2).toBe(2);
    expect((bounds.maxY + bounds.minY) / 2).toBe(-3);
  });

  it.each([
    [{ minX: 2, minY: 0, maxX: 1, maxY: 1 }, 10],
    [{ minX: 0, minY: 0, maxX: Infinity, maxY: 1 }, 10],
    [{ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0],
    [{ minX: 0, minY: 0, maxX: 1, maxY: 1 }, NaN],
    [{ minX: 1e20, minY: 0, maxX: 1e20, maxY: 1 }, 25],
  ] as const)('keeps invalid or unrepresentable bounds unapprovable', (bounds, density) => {
    expect(Object.values(bitmapConversionBounds(bounds, density)).every(Number.isNaN)).toBe(true);
  });
});
