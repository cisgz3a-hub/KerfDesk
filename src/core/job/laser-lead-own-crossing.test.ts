// The own-contour crossing check (ADR-626 Amd 3, 4): long and diagonal edges
// are gridded by the cells they pass through, and still found where a lead
// crosses them.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { crossesOwnContour } from './laser-lead-own-crossing';

function ring(points: ReadonlyArray<Vec2>): Vec2[] {
  return [...points, points[0] as Vec2];
}

describe('own-contour crossings (ADR-626)', () => {
  it('finds a lead crossing a long diagonal edge far from the join', () => {
    // Every edge runs across a hundred or more 1 mm cells, in each direction.
    const triangle = ring([
      { x: 0, y: 0 },
      { x: 100, y: 3 },
      { x: 3, y: 100 },
    ]);
    const join = { x: 0, y: 0 };
    // x + y = 103 is the long edge from (100, 3) to (3, 100).
    expect(
      crossesOwnContour(
        [
          { x: 50, y: 50 },
          { x: 52, y: 52 },
        ],
        join,
        triangle,
      ),
    ).toBe(true);
    expect(
      crossesOwnContour(
        [
          { x: 40, y: 40 },
          { x: 41, y: 41 },
        ],
        join,
        triangle,
      ),
    ).toBe(false);
    // The same edges walked the other way round.
    expect(
      crossesOwnContour(
        [
          { x: 52, y: 52 },
          { x: 50, y: 50 },
        ],
        join,
        [...triangle].reverse(),
      ),
    ).toBe(true);
  });

  it('allows a crossing beside the join, where a lead meets its contour', () => {
    const square = ring([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ]);
    expect(
      crossesOwnContour(
        [
          { x: 5, y: -1 },
          { x: 5.05, y: 0.05 },
        ],
        { x: 5, y: 0 },
        square,
      ),
    ).toBe(false);
  });
});
