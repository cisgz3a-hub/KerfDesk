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

function ring(...points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}

// The curve guard's lookups (ADR-531 amendment 1): whether sample edges come
// within SAMPLES_NEAR_PX (0.045 px), measured beside the contacts.
describe('sample proximity for the curve guard', () => {
  it('finds two rings near where parallel edges are 0.03 px apart, not 0.06 px', () => {
    for (const [gap, near] of [
      [0.03, true],
      [0.06, false],
    ] as const) {
      const cache = new ContourContactCache();
      const block = ring([0, 0], [10, 0], [10, 2], [0, 2]);
      // An arch over the block; its inner roof runs `gap` above the block's
      // top and its legs stand 1 px off the block's sides.
      const top = 2 + gap;
      const arch = ring(
        [-2, -1],
        [-2, 4],
        [12, 4],
        [12, -1],
        [11, -1],
        [11, top],
        [-1, top],
        [-1, -1],
      );
      expect(conflicts(cache, [block, arch])).toEqual([]);
      expect(cache.samplesNear(block.points, arch.points)).toBe(near);
      expect(cache.samplesNear(arch.points, block.points)).toBe(near);
      expect(cache.samplesNearItself(block.points)).toBe(false);
      expect(cache.samplesNearItself(arch.points)).toBe(false);
    }
  });

  it('finds a ring near itself where two edges far apart along it are 0.03 px apart', () => {
    for (const [gap, near] of [
      [0.03, true],
      [0.06, false],
    ] as const) {
      const cache = new ContourContactCache();
      // A block with a slot `gap` wide cut in from its right side, opening
      // into a pocket, so the slot's two walls are six edges apart.
      const slotted = ring(
        [0, 0],
        [12, 0],
        [12, 1],
        [5, 1],
        [5, 0.5],
        [2, 0.5],
        [2, 3],
        [5, 3],
        [5, 1 + gap],
        [12, 1 + gap],
        [12, 4],
        [0, 4],
      );
      expect(conflicts(cache, [slotted])).toEqual([]);
      expect(cache.samplesNearItself(slotted.points)).toBe(near);
    }
  });

  it('measures a near pair whose edges straddle a coarse cell boundary', () => {
    // The block's right edge at x = 7.98 and the frame's inner edge at 8.01
    // lie in different 8 px cells, and nothing else of the two comes near:
    // only cells widened by the reach see that they share one.
    const block = ring([4, 2], [7.98, 2], [7.98, 6], [4, 6]);
    for (const [inner, near] of [
      [8.01, true],
      [8.04, false],
    ] as const) {
      const frame = ring(
        [-1, -1],
        [9, -1],
        [9, 9],
        [-1, 9],
        [-1, 8.1],
        [inner, 8.1],
        [inner, -0.1],
        [-1, -0.1],
      );
      const cache = new ContourContactCache();
      expect(conflicts(cache, [block, frame])).toEqual([]);
      expect(cache.samplesNear(block.points, frame.points)).toBe(near);
    }
  });

  it('knows nothing of pairs and boundaries it has not measured', () => {
    const cache = new ContourContactCache();
    const a = square(0, 0),
      distant = square(10, 10);
    expect(conflicts(cache, [a, distant])).toEqual([]);
    // Boxes apart: the pair is never measured.
    expect(cache.samplesNear(a.points, distant.points)).toBeUndefined();
    expect(cache.samplesNear(a.points, square(0, 0).points)).toBeUndefined();
    expect(cache.samplesNearItself(square(0, 0).points)).toBeUndefined();
    expect(cache.samplesNearItself(a.points)).toBe(false);
    // Touching boundaries are near.
    const touching = square(2, 0);
    expect(conflicts(cache, [a, touching])).toEqual([0, 1]);
    expect(cache.samplesNear(a.points, touching.points)).toBe(true);
  });
});
