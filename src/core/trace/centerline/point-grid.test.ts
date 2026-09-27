import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene';
import { PointGrid } from './point-grid';

function randomPoints(count: number, seed: number): Vec2[] {
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const points = Array.from({ length: count }, () => ({ x: random() * 200, y: random() * 200 }));
  // Points exactly on cell boundaries, duplicates, far and non-finite points.
  points.push({ x: 8, y: 16 }, { x: 8, y: 16 }, { x: 2 ** 41, y: 3 }, { x: Number.NaN, y: 1 });
  return points;
}

describe('point grid', () => {
  const points = randomPoints(400, 3);
  const grid = new PointGrid(points, 8);

  it('answers box queries exactly as a scan does, in list order', () => {
    const boxes = [
      [0, 0, 8, 16],
      [7.999, 15.5, 8, 16],
      [50, 50, 120, 60],
      [-5, -5, 300, 300],
      [0, 0, 2 ** 42, 10],
    ] as const;
    for (const [minX, minY, maxX, maxY] of boxes) {
      const expected = points.filter(
        (p) => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY,
      );
      expect(grid.inBox(minX, minY, maxX, maxY)).toEqual(expected);
    }
  });

  it('answers near-point questions exactly as a scan does', () => {
    for (const p of [...points.slice(0, 50), { x: 8, y: 16 }, { x: 8.5, y: 16.2 }]) {
      for (const radius of [0, 1e-6, 1.5, 6]) {
        const within = points.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= radius);
        expect(grid.anyWithin(p, radius)).toBe(within);
        const near = points.some(
          (q) => Math.abs(q.x - p.x) < radius && Math.abs(q.y - p.y) < radius,
        );
        expect(grid.anyNear(p, radius)).toBe(near);
      }
    }
  });
});
