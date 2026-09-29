import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { roughingReach } from './finish-allowance-coverage';

function loop(points: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: points.map(([x, y]) => ({ x, y })) };
}

function rectangle(minX: number, minY: number, maxX: number, maxY: number): Polyline {
  return loop([
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ]);
}

function square(min: number, max: number): Polyline {
  return rectangle(min, min, max, max);
}

// 1/8" cutter radius plus a 0.5 mm allowance.
const REACH_MM = 1.5875 + 0.5;

describe('roughingReach', () => {
  it('covers a finishing loop the allowance inside its roughing loop', () => {
    const reach = roughingReach([square(-0.5, 40.5)], REACH_MM);

    expect(reach.covers(square(0, 40))).toBe(true);
  });

  it('misses a finishing loop with no roughing near it', () => {
    expect(roughingReach([], REACH_MM).covers(square(0, 1))).toBe(false);
    expect(roughingReach([square(-0.5, 40.5)], REACH_MM).covers(square(19, 21))).toBe(false);
  });

  it('misses the neck between two roughed lobes', () => {
    const lobes = [square(0, 10), rectangle(30, 0, 40, 10)];
    const neckLine: Polyline = {
      closed: false,
      points: [
        { x: 10, y: 5 },
        { x: 30, y: 5 },
      ],
    };
    const dumbbell = loop([
      [-0.5, -0.5],
      [10.5, -0.5],
      [10.5, 4.8],
      [29.5, 4.8],
      [29.5, -0.5],
      [40.5, -0.5],
      [40.5, 10.5],
      [29.5, 10.5],
      [29.5, 5.2],
      [10.5, 5.2],
      [10.5, 10.5],
      [-0.5, 10.5],
    ]);

    expect(roughingReach(lobes, REACH_MM).covers(dumbbell)).toBe(false);
    expect(roughingReach([...lobes, neckLine], REACH_MM).covers(dumbbell)).toBe(true);
  });

  it('finds a long diagonal roughing edge from any point beside it', () => {
    const diagonal: Polyline = {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 300, y: 300 },
      ],
    };
    const beside: Polyline = {
      closed: false,
      points: [
        { x: 1, y: 0 },
        { x: 301, y: 300 },
      ],
    };

    expect(roughingReach([diagonal], REACH_MM).covers(beside)).toBe(true);
  });
});
