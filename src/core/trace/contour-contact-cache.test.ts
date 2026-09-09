import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { ContourContactCache } from './contour-contact-cache';
import { intersectingContourLoopsSteps } from './contour-intersections';
import { runTraceSteps } from './trace-steps';

function square(x: number, y: number, size = 2): Polyline {
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
function conflicts(
  cache: ContourContactCache,
  polylines: ReadonlyArray<Polyline>,
  cooperative = false,
): number[] {
  const steps = intersectingContourLoopsSteps(polylines, cache);
  if (!cooperative) return [...runTraceSteps(steps)];
  for (;;) {
    const step = steps.next(true);
    if (step.done) return [...step.value];
  }
}

describe('cached contour contacts', () => {
  it('reproduces global discovery order when an unrelated contour changes the sweep axis', () => {
    const cache = new ContourContactCache();
    const loops = [square(10, 0), square(11, 1), square(0, 10), square(1, 11)];
    expect(conflicts(cache, loops)).toEqual([2, 3, 0, 1]);
    expect(conflicts(cache, [...loops, square(30, 1000)], true)).toEqual([0, 1, 2, 3]);
    expect(conflicts(cache, loops)).toEqual([2, 3, 0, 1]);
  });

  it('distinguishes a simple loop from two occurrences of the same geometry', () => {
    const cache = new ContourContactCache();
    const loop = square(0, 0);
    expect(conflicts(cache, [loop])).toEqual([]);
    expect(conflicts(cache, [loop, loop], true)).toEqual([0, 1]);
    expect(conflicts(cache, [loop, { ...loop, closed: false }])).toEqual([0, 1]);
    expect(conflicts(cache, [loop])).toEqual([]);
  });

  it('updates ownership and geometry after reordered or replaced boundaries', () => {
    const cache = new ContourContactCache();
    const a = square(0, 0),
      b = square(1, 1),
      distant = square(10, 10);
    expect(conflicts(cache, [a, b])).toEqual([0, 1]);
    expect(conflicts(cache, [b, a])).toEqual([1, 0]);
    expect(conflicts(cache, [a, distant])).toEqual([]);
    expect(conflicts(cache, [a, b])).toEqual([0, 1]);
  });

  it('retains tiny positive gaps and collinear contacts after cached negative results', () => {
    const cache = new ContourContactCache();
    const a = square(-2, -2),
      gap = square(1e-12, -2),
      touching = square(0, -2);
    expect(conflicts(cache, [a, gap])).toEqual([]);
    expect(conflicts(cache, [a, touching])).toEqual([0, 1]);
    expect(conflicts(cache, [a, gap], true)).toEqual([]);
  });

  it('reuses unchanged detailed boundaries instead of reading every point each pass', () => {
    let reads = 0;
    const points: Vec2[] = Array.from({ length: 4096 }, (_, i) => {
      const angle = (i * 2 * Math.PI) / 4096;
      const x = 10 * Math.cos(angle),
        y = 10 * Math.sin(angle);
      return {
        get x() {
          reads += 1;
          return x;
        },
        get y() {
          reads += 1;
          return y;
        },
      };
    });
    const cache = new ContourContactCache();
    const ring = { points, closed: true },
      crossing = square(9, -1);
    expect(conflicts(cache, [ring, crossing])).toEqual([1, 0]);
    reads = 0;
    for (let i = 0; i < 12; i += 1)
      expect(conflicts(cache, [ring, crossing], i % 2 === 0)).toEqual([1, 0]);
    expect(reads).toBeLessThan(1000);
  });
});
