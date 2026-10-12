import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { pointInPolygon } from './point-in-polygon';
import { PolygonEdgeIndex } from './polygon-edge-index';
import {
  segmentContainedInIndexedPolygon,
  segmentContainedInPolygon,
} from './segment-contained-in-polygon';

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

// A star with collinear runs and a repeated vertex, so probes land on edges,
// on vertices and on horizontal edges as well as clear of the boundary.
function star(): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i < 40; i += 1) {
    const a = (i / 40) * Math.PI * 2;
    const r = i % 2 === 0 ? 50 : 20;
    points.push({ x: Math.round(100 + r * Math.cos(a)), y: Math.round(100 + r * Math.sin(a)) });
  }
  points.push({ x: 150, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 120 }, { x: 120, y: 120 });
  return points;
}

describe('PolygonEdgeIndex', () => {
  const polygon = star();
  const index = PolygonEdgeIndex.create(polygon) as PolygonEdgeIndex;
  const next = random(11);
  // Integer probes hit vertices and edges exactly; fractional ones sit near them.
  const probe = (): Vec2 =>
    next() < 0.5
      ? { x: Math.round(40 + next() * 120), y: Math.round(40 + next() * 120) }
      : { x: 40 + next() * 120, y: 40 + next() * 120 };

  it('answers point-in-polygon exactly as the full scan', () => {
    for (let i = 0; i < 4000; i += 1) {
      const point = probe();
      expect(index.containsPoint(point)).toBe(pointInPolygon(point, polygon));
    }
  });

  it('answers segment containment exactly as the full scan', () => {
    for (let i = 0; i < 3000; i += 1) {
      const from = probe();
      const to = probe();
      expect(segmentContainedInIndexedPolygon(from, to, index)).toBe(
        segmentContainedInPolygon(from, to, polygon),
      );
    }
  });

  it('declines to index non-finite coordinates', () => {
    expect(
      PolygonEdgeIndex.create([
        { x: 0, y: 0 },
        { x: Number.NaN, y: 1 },
        { x: 1, y: 1 },
      ]),
    ).toBe(null);
  });
});
