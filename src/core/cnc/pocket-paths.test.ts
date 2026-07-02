import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { pocketToolpathRings } from './pocket-paths';

const TOOL_DIAMETER_MM = 3.175;

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function span(polyline: Polyline): number {
  const xs = polyline.points.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

describe('pocketToolpathRings', () => {
  it('produces multiple clearing rings for a pocket larger than the bit', () => {
    const rings = pocketToolpathRings([square(0, 0, 20)], TOOL_DIAMETER_MM, 40);
    expect(rings.length).toBeGreaterThan(2);
  });

  it('orders rings innermost-first with the wall finishing ring last', () => {
    const rings = pocketToolpathRings([square(0, 0, 20)], TOOL_DIAMETER_MM, 40);
    const first = rings[0];
    const last = rings[rings.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(span(first as Polyline)).toBeLessThan(span(last as Polyline));
    // Ring 0 (emitted last) is inset by exactly the tool radius.
    expect(span(last as Polyline)).toBeCloseTo(20 - TOOL_DIAMETER_MM, 6);
  });

  it('avoids islands: rings never enter an interior hole', () => {
    const rings = pocketToolpathRings([square(0, 0, 30), square(10, 10, 10)], TOOL_DIAMETER_MM, 40);
    expect(rings.length).toBeGreaterThan(0);
    // No ring point may fall strictly inside the island (plus tool radius).
    const islandMin = 10 + TOOL_DIAMETER_MM / 2 - 1e-6;
    const islandMax = 20 - TOOL_DIAMETER_MM / 2 + 1e-6;
    for (const ring of rings) {
      for (const p of ring.points) {
        const strictlyInsideIsland =
          p.x > islandMin && p.x < islandMax && p.y > islandMin && p.y < islandMax;
        expect(strictlyInsideIsland).toBe(false);
      }
    }
  });

  it('returns nothing for open polylines or a bit wider than the pocket', () => {
    const open: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    expect(pocketToolpathRings([open], TOOL_DIAMETER_MM, 40)).toHaveLength(0);
    expect(pocketToolpathRings([square(0, 0, 2)], TOOL_DIAMETER_MM, 40)).toHaveLength(0);
  });
});
