import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { ContourMembership } from './contour-membership';
import { insideContour } from './contour-orientation';

describe('prepared contour winding', () => {
  it('matches exact winding on vertices, edges, notches, self-crossings and tiny gaps', () => {
    const rings: Vec2[][] = [
      [
        { x: -2, y: -1 },
        { x: 2, y: -1 },
        { x: 2, y: 1 },
        { x: -2, y: 1 },
      ],
      [
        { x: -2, y: -1 },
        { x: 2, y: 1 },
        { x: 2, y: -1 },
        { x: -2, y: 1 },
      ],
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 2, y: 1e-12 },
        { x: 0, y: 4 },
      ],
    ];
    const queries = rings
      .flat()
      .flatMap((p) => [
        p,
        { x: p.x + 1e-12, y: p.y },
        { x: p.x - 1e-12, y: p.y },
        { x: p.x, y: p.y + 1e-12 },
        { x: p.x, y: p.y - 1e-12 },
      ]);
    const membership = new ContourMembership();
    for (const ring of rings) {
      for (const points of [ring, [...ring].reverse(), [...ring, ring[0]!]]) {
        for (const point of queries)
          expect(membership.contains(point, points)).toBe(insideContour(point, points));
      }
    }
  });

  it('retains subnormal orientation signs and large finite coordinates', () => {
    const membership = new ContourMembership();
    for (const scale of [1e-200, 1e200]) {
      const points = [
        { x: 0, y: 0 },
        { x: scale, y: 0 },
        { x: scale, y: scale },
        { x: 0, y: scale },
      ];
      for (const x of [-0.1, 0, 0.25, 1, 1.1]) {
        for (const y of [-0.1, 0, 0.25, 1, 1.1]) {
          const point = { x: x * scale, y: y * scale };
          expect(membership.contains(point, points)).toBe(insideContour(point, points));
        }
      }
    }
  });

  it('reuses boundaries without scanning every edge for later membership queries', () => {
    let coordinateReads = 0;
    const points: Vec2[] = [];
    for (const x of [0, 10]) {
      for (let i = 0; i <= 4096; i += 1) {
        const y = x === 0 ? i : 4096 - i;
        points.push({
          get x() {
            coordinateReads += 1;
            return x;
          },
          get y() {
            coordinateReads += 1;
            return y;
          },
        });
      }
    }
    const membership = new ContourMembership();
    expect(membership.contains({ x: 5, y: 1.5 }, points)).toBe(true);
    coordinateReads = 0;
    for (let y = 0.5; y < 100; y += 1) expect(membership.contains({ x: 5, y }, points)).toBe(true);
    expect(coordinateReads).toBeLessThan(10000);
    // A new candidate must get its own boundary and membership result.
    expect(
      membership.contains(
        { x: 5, y: 1.5 },
        points.map((p) => ({ x: p.x + 20, y: p.y })),
      ),
    ).toBe(false);
  });

  it('matches empty and degenerate contour behavior', () => {
    const membership = new ContourMembership();
    for (const points of [
      [],
      [{ x: 0, y: 0 }],
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    ]) {
      expect(membership.contains({ x: 0, y: 0 }, points)).toBe(
        insideContour({ x: 0, y: 0 }, points),
      );
    }
  });

  it('exposes checkpoints while preparing a new detailed boundary', () => {
    const points = Array.from({ length: 4096 }, (_, i) => ({
      x: Math.cos((i * Math.PI) / 2048),
      y: Math.sin((i * Math.PI) / 2048),
    }));
    const steps = new ContourMembership().containsSteps({ x: 0, y: 0 }, points);
    let checkpoints = 0;
    for (;;) {
      const step = steps.next(true);
      if (step.done) {
        expect(step.value).toBe(true);
        break;
      }
      checkpoints += 1;
    }
    expect(checkpoints).toBeGreaterThan(100);
  });
});
