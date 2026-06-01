import { describe, expect, it } from 'vitest';

import { simplifyCenterlinePoints } from './centerline-simplify';

describe('simplifyCenterlinePoints', () => {
  it('collapses near-collinear staircase points to endpoints', () => {
    const points = Array.from({ length: 12 }, (_, i) => ({
      x: i,
      y: Math.floor(i / 2),
    }));

    expect(simplifyCenterlinePoints(points, 1)).toHaveLength(2);
  });

  it('keeps a meaningful bend', () => {
    const simplified = simplifyCenterlinePoints(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 5, y: 5 },
        { x: 6, y: 10 },
      ],
      1,
    );

    expect(simplified.length).toBeGreaterThan(2);
  });
});
