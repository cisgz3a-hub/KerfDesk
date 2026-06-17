import { describe, expect, it } from 'vitest';
import { square } from '../../__fixtures__/square';
import { fillHatchingWithMetadata } from './fill-hatching';

describe('fillHatchingWithMetadata', () => {
  it('marks alternating bidirectional scanlines as reverse', () => {
    const result = fillHatchingWithMetadata({
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.25,
    });

    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.slice(0, 4).map((line) => line.reverse)).toEqual([false, true, false, true]);
  });

  it('marks every unidirectional scanline as forward', () => {
    const result = fillHatchingWithMetadata({
      polylines: [square(1)],
      hatchAngleDeg: 0,
      hatchSpacingMm: 0.25,
      bidirectional: false,
    });

    expect(result.length).toBeGreaterThanOrEqual(4);
    expect(result.every((line) => line.reverse === false)).toBe(true);
  });
});
