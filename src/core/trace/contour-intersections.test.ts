import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import { intersectingContourLoopsSteps } from './contour-intersections';
import { contourOrientation } from './contour-orientation';
import { runTraceSteps } from './trace-steps';

function ring(points: ReadonlyArray<Vec2>): Polyline {
  return { closed: true, points: [...points, points[0]!] };
}
function square(x: number, y = 0, size = 1): Polyline {
  return ring([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ]);
}
const conflicts = (paths: Polyline[]): number[] =>
  [...runTraceSteps(intersectingContourLoopsSteps(paths))].sort();

describe('continuous contour intersection checks', () => {
  it('detects a crossing of the closing edge', () => {
    expect(
      conflicts([
        ring([
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 0, y: 2 },
          { x: 2, y: 2 },
        ]),
      ]),
    ).toEqual([0]);
  });
  it('detects crossings between different loops', () => {
    expect(conflicts([square(0), square(0.5, 0.5)])).toEqual([0, 1]);
  });
  it('distinguishes a tiny positive gap from contact', () => {
    expect(conflicts([square(0), square(1 + 1e-12)])).toEqual([]);
    expect(conflicts([square(0), square(1, 1)])).toEqual([0, 1]);
  });
  it('finds collinear overlapping boundaries', () => {
    expect(conflicts([square(0), square(1)])).toEqual([0, 1]);
  });
  it('does not call a contained counter an intersection', () => {
    expect(conflicts([square(0, 0, 5), square(1, 1)])).toEqual([]);
  });
  it('uses exact signs even when the ordinary determinant underflows', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1e-200, y: 1e-200 };
    const c = { x: 2e-200, y: 3e-200 };
    expect(contourOrientation(a, b, c)).toBe(1);
    expect(contourOrientation(a, c, b)).toBe(-1);
    expect(contourOrientation(a, b, { x: 2e-200, y: 2e-200 })).toBe(0);
  });
  it('keeps the same result in a cooperative run', () => {
    const paths = [square(0), square(0.5, 0.5), square(7)];
    const steps = intersectingContourLoopsSteps(paths);
    let result = steps.next(true);
    let checkpoints = 0;
    while (!result.done) {
      checkpoints += 1;
      result = steps.next(true);
    }
    expect(checkpoints).toBeGreaterThan(paths.length);
    expect([...result.value].sort()).toEqual(conflicts(paths));
  });
});
