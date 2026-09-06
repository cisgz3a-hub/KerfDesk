import { describe, expect, it } from 'vitest';

import type { Polyline, Vec2 } from '../scene';
import { offsetFillContours } from './offset-fill';

function polygon(points: ReadonlyArray<Vec2>): Polyline {
  const first = points[0];
  if (first === undefined) throw new Error('fixture needs vertices');
  return { closed: true, points: [...points, first] };
}

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return polygon([
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ]);
}

function rephase(line: Polyline, seam: number, reverse: boolean): Polyline {
  const points = line.points.slice(0, -1);
  const rotated = [...points.slice(seam), ...points.slice(0, seam)];
  return polygon(reverse ? rotated.reverse() : rotated);
}

function edgeKeys(lines: ReadonlyArray<Polyline>): string[] {
  return lines
    .flatMap((line) =>
      line.points.slice(1).map((b, i) => {
        const a = line.points[i];
        if (a === undefined) throw new Error('missing edge start');
        return [`${a.x},${a.y}`, `${b.x},${b.y}`].sort().join(':');
      }),
    )
    .sort();
}

function nearest(point: Vec2, lines: ReadonlyArray<Polyline>): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.points.length; i += 1) {
      const a = line.points[i - 1];
      const b = line.points[i];
      if (a === undefined || b === undefined) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
      best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
    }
  }
  return best;
}

describe('Follow Shape filled region', () => {
  it.each([
    {
      name: 'accepted overlap',
      a: rectangle(0, 0, 10, 10),
      b: rectangle(5, 5, 10, 10),
      spacing: 0.5,
    },
    {
      name: 'alternate overlap',
      a: rectangle(0, 0, 12, 8),
      b: rectangle(6, 3, 8, 12),
      spacing: 0.4,
    },
  ])(
    '$name retains both exclusive interiors for every seam, order and winding',
    ({ a, b, spacing }) => {
      const reference = offsetFillContours({ polylines: [a, b], spacingMm: spacing });
      expect(reference.termination).toEqual({ kind: 'complete' });
      expect(nearest({ x: 2, y: 2 }, reference.contours)).toBeLessThanOrEqual(spacing / 2 + 1e-8);
      expect(nearest({ x: 12, y: 12 }, reference.contours)).toBeLessThanOrEqual(spacing / 2 + 1e-8);
      const expected = edgeKeys(reference.contours);
      for (let first = 0; first < 4; first += 1) {
        for (let second = 0; second < 4; second += 1) {
          for (let winding = 0; winding < 4; winding += 1) {
            for (const swapped of [false, true]) {
              const region = [
                rephase(a, first, (winding & 1) !== 0),
                rephase(b, second, (winding & 2) !== 0),
              ];
              const result = offsetFillContours({
                polylines: swapped ? region.reverse() : region,
                spacingMm: spacing,
              });
              expect(result.termination).toEqual({ kind: 'complete' });
              expect(edgeKeys(result.contours)).toEqual(expected);
            }
          }
        }
      }
    },
  );

  it('uses even-odd cancellation for identical contours in either winding', () => {
    const outer = rectangle(0, 0, 20, 20);
    for (const reverse of [false, true]) {
      expect(
        offsetFillContours({ polylines: [outer, rephase(outer, 2, reverse)], spacingMm: 0.5 }),
      ).toEqual({ contours: [], termination: { kind: 'complete' } });
    }
  });

  it('preserves a counter and an island inside that counter', () => {
    const region = [rectangle(0, 0, 20, 20), rectangle(4, 4, 12, 12), rectangle(8, 8, 4, 4)];
    const result = offsetFillContours({ polylines: region, spacingMm: 0.5 });
    expect(nearest({ x: 2, y: 2 }, result.contours)).toBeCloseTo(0.25, 8);
    expect(nearest({ x: 10, y: 10 }, result.contours)).toBeCloseTo(0.25, 8);
    expect(nearest({ x: 6, y: 10 }, result.contours)).toBeGreaterThan(2);
    expect(result.termination).toEqual({ kind: 'complete' });
  });

  it('resolves a zero-signed-area bow tie before testing contour area', () => {
    const bowTie = polygon([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ]);
    const result = offsetFillContours({ polylines: [bowTie], spacingMm: 0.5 });
    expect(nearest({ x: 5, y: 2 }, result.contours)).toBeLessThan(0.3);
    expect(nearest({ x: 5, y: 8 }, result.contours)).toBeLessThan(0.3);
    expect(result.termination).toEqual({ kind: 'complete' });
  });

  it.each([
    { name: 'disconnected', second: rectangle(15, 0, 10, 10) },
    { name: 'edge touching', second: rectangle(10, 0, 10, 10) },
    { name: 'corner touching', second: rectangle(10, 10, 10, 10) },
  ])('$name preserves both components', ({ second }) => {
    const result = offsetFillContours({
      polylines: [rectangle(0, 0, 10, 10), second],
      spacingMm: 0.5,
    });
    const origin = second.points[0];
    if (origin === undefined) throw new Error('missing fixture origin');
    expect(nearest({ x: 2, y: 2 }, result.contours)).toBeLessThan(0.3);
    expect(nearest({ x: origin.x + 2, y: origin.y + 2 }, result.contours)).toBeLessThan(0.3);
    expect(result.termination).toEqual({ kind: 'complete' });
  });

  it.each([0, 0.001, 0.049, 0.05])(
    'retains the existing minimum spacing for %s mm',
    (spacingMm) => {
      const result = offsetFillContours({ polylines: [rectangle(0, 0, 1, 1)], spacingMm });
      expect(result.contours).toHaveLength(10);
      expect(nearest({ x: 0, y: 0.5 }, result.contours)).toBeCloseTo(0.025, 8);
      expect(result.termination).toEqual({ kind: 'complete' });
    },
  );
});
