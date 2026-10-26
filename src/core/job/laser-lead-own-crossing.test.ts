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

  it('reads the filled cells when a lead spans more cells than the contour fills', () => {
    // A 0.5 mm circle, densely drawn, and a lead whose box spans many cells.
    const small = ring(
      Array.from({ length: 200 }, (_, index) => {
        const angle = (index / 200) * 2 * Math.PI;
        return { x: 0.25 + 0.25 * Math.cos(angle), y: 0.25 + 0.25 * Math.sin(angle) };
      }),
    );
    const across = [
      { x: -20, y: 0.25 },
      { x: 20, y: 0.3 },
    ];
    expect(crossesOwnContour(across, small[0] as Vec2, small)).toBe(true);
    const clear = [
      { x: -20, y: 5 },
      { x: 20, y: 5 },
    ];
    expect(crossesOwnContour(clear, small[0] as Vec2, small)).toBe(false);
  });

  it('finds a lead running along its own contour past the join', () => {
    const square = ring([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ]);
    const join = { x: 5, y: 0 };
    // Along the bottom edge for 2 mm: far past the join's 0.2 mm.
    const along = [
      { x: 5, y: 0 },
      { x: 7, y: 0 },
    ];
    expect(crossesOwnContour(along, join, square)).toBe(true);
    // Riding it for 0.1 mm beside the join is allowed.
    const beside = [
      { x: 5, y: 0 },
      { x: 5.1, y: 0 },
      { x: 5.1, y: -1 },
    ];
    expect(crossesOwnContour(beside, join, square)).toBe(false);
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
