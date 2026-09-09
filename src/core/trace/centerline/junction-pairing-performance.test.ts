import { describe, expect, it, vi } from 'vitest';
import { bridgeNearbyEnds, type Chain } from './junction-pairing';

const line = (x1: number, y1: number, x2: number, y2: number): Chain => ({
  points: [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ],
  closed: false,
  alive: true,
});

describe('gap search work and selection order', () => {
  it('avoids quadratic distance work on separated strokes', () => {
    const chains = Array.from({ length: 650 }, (_, i) => line(i * 16, 0, i * 16 + 1, 0));
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      bridgeNearbyEnds(chains, 3);
      expect(chains.every((chain) => chain.alive)).toBe(true);
      // Distant strokes must not require pairwise Euclidean distance checks.
      expect(hypot.mock.calls.length).toBeLessThan(chains.length * 16);
    } finally {
      hypot.mockRestore();
    }
  });

  for (const offset of [-100, 0, 100]) {
    it(`keeps chain order when equally near ends occupy different cells, offset=${offset}`, () => {
      const chains = [
        line(offset - 10, offset, offset, offset),
        line(offset + 1, offset + 1, offset + 1, offset + 10),
        line(offset + 1, offset - 1, offset + 1, offset - 10),
      ];
      const expected = [...(chains[0]?.points ?? []), ...(chains[1]?.points ?? [])];
      bridgeNearbyEnds(chains, 2);
      expect(chains[0]?.points).toEqual(expected);
      expect(chains[1]?.alive).toBe(false);
      expect(chains[2]?.alive).toBe(true);
    });
  }

  it('recomputes an outer tangent after joining a chain shorter than the tangent probe', () => {
    const chains = [line(0, 0, 0.1, 0), line(0.2, 0, 0.2, 4), line(0, -1, 0, -4)];
    bridgeNearbyEnds(chains, 1.1);
    expect(chains.filter((chain) => chain.alive)).toHaveLength(1);
    expect(chains[0]?.points).toEqual([
      { x: 0.2, y: 4 },
      { x: 0.2, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: -4 },
    ]);
  });
});
