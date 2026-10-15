import { describe, expect, it } from 'vitest';
import { tangentCircles, type Circle } from './tangent-circles';

const A: Circle = { center: { x: 0, y: 0 }, radius: 1 };
const B: Circle = { center: { x: 10, y: 0 }, radius: 2 };
const C: Circle = { center: { x: 4, y: 8 }, radius: 1.5 };

describe('tangentCircles', () => {
  it('recovers a known tangent circle across 256 rotated, scaled and translated constructions', () => {
    for (let sample = 0; sample < 256; sample += 1) {
      const scale = 10 ** ((sample % 9) - 4);
      const center = { x: 12345, y: -67890 };
      const radius = 10 * scale;
      const circles = [1, 2, 3].map((inputRadius, index) => {
        const angle = sample * 0.37 + index * ((2 * Math.PI) / 3);
        const distance = radius + inputRadius * scale;
        return {
          center: {
            x: center.x + Math.cos(angle) * distance,
            y: center.y + Math.sin(angle) * distance,
          },
          radius: inputRadius * scale,
        };
      }) as [Circle, Circle, Circle];
      expect(
        tangentCircles(...circles).some(
          (solution) =>
            Math.hypot(solution.center.x - center.x, solution.center.y - center.y) <
              1e-7 * Math.max(1, scale) &&
            Math.abs(solution.radius - radius) < 1e-7 * Math.max(1, scale),
        ),
      ).toBe(true);
    }
  });

  it('finds the finite solutions for collinear centres with unequal radii', () => {
    const circles: [Circle, Circle, Circle] = [
      { center: { x: 0, y: 0 }, radius: 1 },
      { center: { x: 4, y: 0 }, radius: 2 },
      { center: { x: 8, y: 0 }, radius: 1 },
    ];
    const solutions = tangentCircles(...circles);
    for (const y of [-7.5, 7.5]) {
      expect(
        solutions.some(
          (solution) =>
            Math.abs(solution.center.x - 4) < 1e-7 &&
            Math.abs(solution.center.y - y) < 1e-7 &&
            Math.abs(solution.radius - 9.5) < 1e-7,
        ),
      ).toBe(true);
    }
  });

  it.each([1e-4, 1, 1e4])('preserves tangency under scale %s and large translation', (scale) => {
    const offset = { x: 1e8, y: -1e8 };
    const circles = [A, B, C].map((circle) => ({
      center: { x: offset.x + circle.center.x * scale, y: offset.y + circle.center.y * scale },
      radius: circle.radius * scale,
    })) as [Circle, Circle, Circle];
    const solutions = tangentCircles(...circles);
    expect(solutions).toHaveLength(8);
    for (const solution of solutions)
      circles.forEach((circle, index) => {
        const distance = Math.hypot(
          solution.center.x - circle.center.x,
          solution.center.y - circle.center.y,
        );
        const expected =
          solution.contact[index] === 'outside'
            ? solution.radius + circle.radius
            : Math.abs(solution.radius - circle.radius);
        expect(Math.abs(distance - expected)).toBeLessThan(1e-7 * Math.max(1, scale));
      });
  });

  it('rejects non-finite and nonpositive input circles', () => {
    for (const radius of [0, -1, Infinity, NaN])
      expect(tangentCircles({ ...A, radius }, B, C)).toEqual([]);
    expect(tangentCircles({ ...A, center: { x: Infinity, y: 0 } }, B, C)).toEqual([]);
  });

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

  it('finds the symmetric mixed-contact solutions for collinear equal circles', () => {
    const line = [0, 10, 20].map((x) => ({ center: { x, y: 0 }, radius: 1 }));
    const solutions = tangentCircles(line[0] as Circle, line[1] as Circle, line[2] as Circle);
    // For the symmetric pair, x = 10. Subtracting y² = (r - 1)² from
    // y² + 100 = (r + 1)² gives r = 25, then y = ±24.
    for (const y of [-24, 24]) {
      const solution = solutions.find((candidate) => Math.abs(candidate.center.y - y) < 1e-7);
      expect(solution).toBeDefined();
      expect(solution?.center.x).toBeCloseTo(10, 7);
      expect(solution?.radius).toBeCloseTo(25, 7);
      expect(solution?.contact).toEqual(['outside', 'inside', 'outside']);
    }
    for (const solution of solutions) {
      line.forEach((circle, index) => {
        const distance = Math.hypot(
          solution.center.x - circle.center.x,
          solution.center.y - circle.center.y,
        );
        const expected =
          solution.contact[index] === 'outside'
            ? solution.radius + circle.radius
            : Math.abs(solution.radius - circle.radius);
        expect(distance).toBeCloseTo(expected, 7);
      });
    }
  });

  it('preserves solution geometry and contact labels for all input permutations', () => {
    const inputs = [A, B, C] as const;
    const reference = tangentCircles(...inputs);
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ] as const) {
      const solutions = tangentCircles(inputs[order[0]], inputs[order[1]], inputs[order[2]]);
      expect(solutions).toHaveLength(reference.length);
      for (const original of reference) {
        const candidate = solutions.find(
          (solution) =>
            Math.hypot(
              solution.center.x - original.center.x,
              solution.center.y - original.center.y,
            ) < 1e-7 && Math.abs(solution.radius - original.radius) < 1e-7,
        );
        expect(candidate).toBeDefined();
        expect(candidate?.contact).toEqual(order.map((index) => original.contact[index]));
      }
    }
  });
});
