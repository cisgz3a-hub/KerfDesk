import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { selectLineArtContours } from './line-art-contours';

const OUTER = [
  [0, 0],
  [40, 0],
  [40, 40],
  [0, 40],
] as const;

function transformedRing(
  points: ReadonlyArray<readonly [number, number]>,
  degrees: number,
  scale: number,
): Polyline {
  const angle = (degrees * Math.PI) / 180;
  return {
    closed: true,
    points: points.map(([x, y]) => ({
      x: 0.13 + scale * (x * Math.cos(angle) - y * Math.sin(angle)),
      y: 0.29 + scale * (x * Math.sin(angle) + y * Math.cos(angle)),
    })),
  };
}

describe('line-art containment at transformed contact', () => {
  it.each([0, 1e-7])('distinguishes touching from a %s mm interior gap', (gap) => {
    const child = [
      [1, 1],
      [39, 1],
      [40 - gap, 20],
      [39, 39],
      [1, 39],
    ] as const;
    for (let degrees = 0; degrees < 360; degrees += 1) {
      for (const scale of [1, 0.27, 2.5]) {
        const outer = transformedRing(OUTER, degrees, scale);
        const inner = transformedRing(child, degrees, scale);
        for (const side of ['inner', 'outer'] as const) {
          expect(
            selectLineArtContours([outer, inner], side, 20),
            `${degrees} degrees / ${scale}`,
          ).toEqual(gap === 0 ? [outer, inner] : [side === 'inner' ? inner : outer]);
        }
      }
    }
  });
});
