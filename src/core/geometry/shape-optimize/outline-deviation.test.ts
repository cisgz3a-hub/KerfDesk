import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../scene/scene-object';
import { outlineDeviationMm } from './outline-deviation';

function noise(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function edges(points: ReadonlyArray<Vec2>, closed: boolean): Array<readonly [Vec2, Vec2]> {
  const count = closed ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, k) => [
    points[k] as Vec2,
    points[(k + 1) % points.length] as Vec2,
  ]);
}

// Every 0.0005 mm along one outline, the distance to the nearest edge of the other.
function bruteDirected(
  from: ReadonlyArray<Vec2>,
  fromClosed: boolean,
  to: ReadonlyArray<Vec2>,
  toClosed: boolean,
): number {
  const targets = edges(to, toClosed);
  let worst = 0;
  for (const [a, b] of edges(from, fromClosed)) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.0005));
    for (let k = 0; k <= steps; k += 1) {
      const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps };
      worst = Math.max(worst, Math.min(...targets.map(([c, d]) => segmentDistance(p, c, d))));
    }
  }
  return worst;
}

describe('outlineDeviationMm', () => {
  it('matches a brute-force two-way distance to within half its resolution', () => {
    for (const seed of [1, 2, 3, 4]) {
      const random = noise(seed);
      const ring = (radius: number, count: number, wobble: number): Vec2[] =>
        Array.from({ length: count }, (_, k) => {
          const angle = (2 * Math.PI * k) / count;
          const r = radius + wobble * random();
          return { x: 3 + r * Math.cos(angle), y: -2 + r * Math.sin(angle) };
        });
      const before = ring(2, 60, 0.2);
      const after = ring(2, 17, 0.05);
      const brute = Math.max(
        bruteDirected(before, true, after, true),
        bruteDirected(after, true, before, true),
      );
      const fast = outlineDeviationMm(before, true, after, true);
      expect(fast).toBeLessThanOrEqual(brute + 1e-9);
      expect(fast).toBeGreaterThanOrEqual(brute - 0.0025);
    }
  });

  it('finds a bulge in the middle of a long edge and measures open outlines to their ends', () => {
    const straight = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ];
    const bulge = [
      { x: 0, y: 0 },
      { x: 5, y: 0.3 },
      { x: 10, y: 0 },
    ];
    expect(outlineDeviationMm(straight, false, bulge, false)).toBeCloseTo(0.3, 3);
    const shorter = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
    ];
    expect(outlineDeviationMm(straight, false, shorter, false)).toBeCloseTo(2, 9);
  });
});
