// ADR-486 Amendment 5: the line of a closed contour that a derived outline
// leaves behind, counted once where the contour runs back over itself.
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { partlyDroppedLineMm } from './dropped-contour-line';
import { retracedLineMm } from './zero-area-contour';

const p = (x: number, y: number): Vec2 => ({ x, y });
const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  p(x0, y0),
  p(x1, y0),
  p(x1, y1),
  p(x0, y1),
];
const OPTIONS = { reachMm: 0.005, minRunMm: 1 };

describe('partlyDroppedLineMm', () => {
  it('reads 0 when the result follows the source', () => {
    const square = box(0, 0, 20, 20);
    expect(partlyDroppedLineMm([square], [square], OPTIONS)).toEqual([0]);
  });

  it('reads 0 for a source the result left out entirely: other checks name it', () => {
    expect(partlyDroppedLineMm([box(0, 0, 20, 20)], [], OPTIONS)).toEqual([0]);
  });

  it('counts a retraced stem once: 25 mm, not the 50 mm of contour over it', () => {
    const P = [p(0, 0), p(0, 50), p(25, 50), p(25, 25), p(0, 25)];
    const [dropped] = partlyDroppedLineMm([P], [box(0, 25, 25, 50)], OPTIONS);
    expect(dropped).toBeGreaterThan(24.5);
    expect(dropped).toBeLessThan(25.5);
  });

  it('ignores a run shorter than minRunMm', () => {
    // A 0.4 mm spur: 0.8 mm of contour, under the 1 mm floor.
    const spur = [p(0, 0), p(20, 0), p(20, 20), p(10, 20), p(10, 20.4), p(10, 20), p(0, 20)];
    expect(partlyDroppedLineMm([spur], [box(0, 0, 20, 20)], OPTIONS)).toEqual([0]);
  });

  it('a result line within reach counts as cutting the source', () => {
    const offset = box(-0.1, -0.1, 20.1, 20.1);
    expect(
      partlyDroppedLineMm([box(0, 0, 20, 20)], [offset], { reachMm: 0.302, minRunMm: 1 }),
    ).toEqual([0]);
  });
});

describe('retracedLineMm', () => {
  it('names the stick of a lollipop, 40 mm', () => {
    const lollipop = [p(0, 0), p(40, 0), p(40, -10), p(60, -10), p(60, 10), p(40, 10), p(40, 0)];
    expect(retracedLineMm(lollipop)).toBeCloseTo(40, 0);
  });

  it('reads 0 for a simple ring, a figure eight and a whole out-and-back', () => {
    expect(retracedLineMm(box(0, 0, 20, 20))).toBe(0);
    expect(retracedLineMm([p(0, 0), p(10, 10), p(10, 0), p(0, 10)])).toBe(0);
    expect(retracedLineMm([p(0, 0), p(30, 0), p(10, 0)])).toBe(0);
  });

  it('reads 0 for a closing line 0.05 mm beside the stem: the sliver has an inside', () => {
    expect(retracedLineMm([p(0, 0), p(0, 50), p(25, 50), p(25, 25), p(0.05, 25)])).toBe(0);
  });
});
