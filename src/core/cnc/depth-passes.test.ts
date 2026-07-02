import { describe, expect, it } from 'vitest';
import { zPassDepths } from './depth-passes';

describe('zPassDepths', () => {
  it('splits depth into equal passes with an exact final depth', () => {
    expect(zPassDepths(3, 1.5)).toEqual([-1.5, -3]);
  });

  it('clamps the last pass to the target depth', () => {
    expect(zPassDepths(3, 2)).toEqual([-2, -3]);
  });

  it('lands exactly on the target across rounding-hostile divisions', () => {
    const depths = zPassDepths(1, 0.3);
    expect(depths).toHaveLength(4);
    expect(depths[depths.length - 1]).toBe(-1);
  });

  it('uses a single pass when depth-per-pass covers the full depth', () => {
    expect(zPassDepths(5, 5)).toEqual([-5]);
    expect(zPassDepths(5, 50)).toEqual([-5]);
  });

  it('treats a non-positive depth-per-pass as one full-depth pass', () => {
    expect(zPassDepths(3, 0)).toEqual([-3]);
    expect(zPassDepths(3, -1)).toEqual([-3]);
  });

  it('returns no passes for a non-positive depth', () => {
    expect(zPassDepths(0, 1)).toEqual([]);
    expect(zPassDepths(-2, 1)).toEqual([]);
    expect(zPassDepths(Number.NaN, 1)).toEqual([]);
  });

  it('is monotonically deepening', () => {
    const depths = zPassDepths(10, 1.7);
    for (let i = 1; i < depths.length; i += 1) {
      expect(depths[i]).toBeLessThan(depths[i - 1] ?? 0);
    }
  });
});
