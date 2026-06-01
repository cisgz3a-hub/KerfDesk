import { describe, expect, it } from 'vitest';
import { expandFillHatchWithOverscan } from './fill-overscan';

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
