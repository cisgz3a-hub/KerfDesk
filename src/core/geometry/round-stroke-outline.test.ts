import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { roundStrokeOutline } from './round-stroke-outline';

describe('roundStrokeOutline', () => {
  it('turns an open centerline into one closed round-ended region', () => {
    const result = roundStrokeOutline(
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
      ],
      2,
    );

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result?.[0]?.closed).toBe(true);
    const resultBounds = bounds(result ?? []);
    expect(resultBounds.minX).toBeCloseTo(-1, 2);
    expect(resultBounds.minY).toBeCloseTo(-1, 2);
    expect(resultBounds.maxX).toBeCloseTo(11, 2);
    expect(resultBounds.maxY).toBeCloseTo(1, 2);
  });

  it('keeps the interior of a closed centerline stroke as a hole', () => {
    const result = roundStrokeOutline(
      [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
          ],
        },
      ],
      2,
    );

    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result?.every((polyline) => polyline.closed)).toBe(true);
    expect(bounds(result ?? [])).toEqual({ minX: -1, minY: -1, maxX: 11, maxY: 11 });
  });

  it('unions overlapping stroke pieces into one visible region', () => {
    const result = roundStrokeOutline(
      [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        {
          closed: false,
          points: [
            { x: 5, y: -5 },
            { x: 5, y: 5 },
          ],
        },
      ],
      2,
    );

    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
  });
});

function bounds(polylines: ReadonlyArray<Polyline>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  const points = polylines.flatMap((polyline) => polyline.points);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}
