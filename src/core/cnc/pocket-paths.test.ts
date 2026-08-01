import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { pocketToolpathRaster, pocketToolpathRings } from './pocket-paths';

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
  // Audit 1.10: the ring ladder broke on the first empty offset with no final
  // ring, so a stepover wider than the tool radius left a full-depth core.
  it('clears the core when the stepover exceeds the tool radius', () => {
    // The audit's case: 6.35 mm bit at the 85% UI maximum in a pocket of
    // inradius 8.175. Pre-fix this produced one ring at inset 3.175, sweeping
    // only to 1.825 from the centre - a 3.65 mm full-depth pillar.
    const SIZE_MM = 16.35;
    const TOOL_MM = 6.35;
    const rings = pocketToolpathRings([square(0, 0, SIZE_MM)], TOOL_MM, 85);
    expect(rings.length).toBeGreaterThan(1);
    const innermost = rings[0] as Polyline;
    const inset = (SIZE_MM - span(innermost)) / 2;
    // The innermost ring's sweep must reach the medial axis: its distance from
    // the centre cannot exceed the tool radius, or material is left standing.
    expect(SIZE_MM / 2 - inset).toBeLessThanOrEqual(TOOL_MM / 2 + 1e-6);
  });

  it('keeps every ring on the stepover lattice at the 40% default', () => {
    // Below 50% the final sweep always covers the centre, so the bisection must
    // not run and existing output must not move.
    const rings = pocketToolpathRings([square(0, 0, 20)], TOOL_DIAMETER_MM, 40);
    const stepMm = 0.4 * TOOL_DIAMETER_MM;
    const inset = (20 - span(rings[0] as Polyline)) / 2;
    const k = (inset - TOOL_DIAMETER_MM / 2) / stepMm;
    expect(k).toBeCloseTo(Math.round(k), 6);
  });

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

describe('pocketToolpathRaster (ADR-105 G10)', () => {
  const square: Polyline = {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
    ],
  };

  it('sweeps the radius-inset region and finishes with the wall pass last', () => {
    const paths = pocketToolpathRaster([square], 4, 40, 'x');
    expect(paths.length).toBeGreaterThan(2);
    // Every sweep point stays inside the bit-center region (inset by r=2).
    for (const path of paths) {
      for (const p of path.points) {
        expect(p.x).toBeGreaterThanOrEqual(2 - 1e-6);
        expect(p.x).toBeLessThanOrEqual(18 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(2 - 1e-6);
        expect(p.y).toBeLessThanOrEqual(18 + 1e-6);
      }
    }
    // The last path is the closed finishing wall ring.
    expect(paths.at(-1)?.closed).toBe(true);
    // X sweeps are horizontal open lines.
    const first = paths[0];
    expect(first?.closed).toBe(false);
    expect(first?.points.every((p) => Math.abs(p.y - (first.points[0]?.y ?? 0)) < 1e-6)).toBe(true);
  });

  it('raster-y sweeps run vertically instead', () => {
    const paths = pocketToolpathRaster([square], 4, 40, 'y');
    const first = paths[0];
    expect(first?.closed).toBe(false);
    expect(first?.points.every((p) => Math.abs(p.x - (first.points[0]?.x ?? 0)) < 1e-6)).toBe(true);
  });

  it('returns empty when the bit cannot fit', () => {
    expect(pocketToolpathRaster([square], 50, 40, 'x')).toEqual([]);
  });
});
