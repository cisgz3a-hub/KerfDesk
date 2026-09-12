import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { ContourMembership } from './contour-membership';
import { insideContour } from './contour-orientation';

describe('repeated topology membership', () => {
  it('does not revisit an unchanged boundary for the same refinement queries', () => {
    let boundaryReads = 0;
    const points: Vec2[] = [];
    for (const x of [0, 10]) {
      for (let i = 0; i <= 512; i += 1) {
        const y = x === 0 ? i : 512 - i;
        points.push({
          get x() {
            boundaryReads += 1;
            return x;
          },
          get y() {
            boundaryReads += 1;
            return y;
          },
        });
      }
    }
    const membership = new ContourMembership();
    const queries = Array.from({ length: 128 }, (_, y) => ({ x: 5, y: y + 0.5 }));
    for (const point of queries) expect(membership.contains(point, points)).toBe(true);
    boundaryReads = 0;
    // Source containment is unchanged through all twelve topology refinements.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      for (const point of queries) expect(membership.contains(point, points)).toBe(true);
    }
    expect(boundaryReads).toBe(0);
  });

  it('invalidates changed query coordinates and keeps candidate boundaries separate', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 3, y: 4 },
      { x: 3, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 4 },
      { x: 0, y: 4 },
    ];
    const membership = new ContourMembership();
    const query = { x: 0.5, y: 2 };
    const moved = points.map(({ x, y }) => ({ x: x + 1, y }));
    for (const x of [0.5, 2, 3.5, 2, 0.5]) {
      query.x = x;
      for (const boundary of [points, moved]) {
        const expected = insideContour(query, boundary);
        expect(membership.contains(query, boundary)).toBe(expected);
        expect(membership.contains(query, boundary)).toBe(expected);
      }
    }
    query.x = 2;
    query.y = 0.5;
    expect(membership.contains(query, points)).toBe(true);
  });

  it('does not publish an incomplete result when boundary preparation is cancelled', () => {
    const points = Array.from({ length: 512 }, (_, i) => ({
      x: Math.cos((i * Math.PI) / 256),
      y: Math.sin((i * Math.PI) / 256),
    }));
    const membership = new ContourMembership();
    const query = { x: 0, y: 0 };
    const steps = membership.containsSteps(query, points);
    for (let i = 0; i < 6; i += 1) expect(steps.next(true).done).toBe(false);
    steps.return(false);
    expect(membership.contains(query, points)).toBe(true);
    expect(membership.contains(query, points)).toBe(true);
  });
});
