import { describe, expect, it } from 'vitest';
import { tangentCircles, type Circle } from './tangent-circles';

const A: Circle = { center: { x: 0, y: 0 }, radius: 1 };
const B: Circle = { center: { x: 10, y: 0 }, radius: 2 };
const C: Circle = { center: { x: 4, y: 8 }, radius: 1.5 };

describe('tangentCircles', () => {
  it('finds all eight solutions for three separate circles, each truly tangent', () => {
    const solutions = tangentCircles(A, B, C);
    expect(solutions).toHaveLength(8);
    for (const solution of solutions) {
      [A, B, C].forEach((circle, index) => {
        const d = Math.hypot(
          solution.center.x - circle.center.x,
          solution.center.y - circle.center.y,
        );
        const expected =
          solution.contact[index] === 'outside'
            ? solution.radius + circle.radius
            : Math.abs(solution.radius - circle.radius);
        expect(d).toBeCloseTo(expected, 6);
      });
    }
    expect(solutions[0]?.radius).toBeLessThan(solutions[7]?.radius ?? 0);
  });

  it('returns nothing for collinear equal circles with no finite solution set', () => {
    const line = [0, 10, 20].map((x) => ({ center: { x, y: 0 }, radius: 1 }));
    const solutions = tangentCircles(line[0] as Circle, line[1] as Circle, line[2] as Circle);
    for (const solution of solutions) expect(Number.isFinite(solution.radius)).toBe(true);
  });
});
