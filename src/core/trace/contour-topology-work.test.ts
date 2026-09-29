import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Polyline } from '../scene';
import { ContourMembership } from './contour-membership';
import { preserveContourTopologySteps, type FinishedContour } from './contour-topology';
import { runTraceSteps } from './trace-steps';

function circle(radius: number, count: number, read: () => void): Polyline {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count;
    const x = radius * Math.cos(angle),
      y = radius * Math.sin(angle);
    return Object.freeze({
      get x() {
        read();
        return x;
      },
      get y() {
        read();
        return y;
      },
    });
  });
  return Object.freeze({ closed: true, points: Object.freeze(points) });
}

afterEach(() => vi.restoreAllMocks());

describe('topology work during repeated repairs', () => {
  it.each(['detailed', 'nested'] as const)(
    'reuses unchanged %s boundaries and containment relationships',
    (kind) => {
      let coordinateReads = 0;
      const contains = vi.spyOn(ContourMembership.prototype, 'containsSteps');
      const source: Polyline = {
        closed: true,
        points: [
          { x: 10000, y: 10000 },
          { x: 10002, y: 10000 },
          { x: 10002, y: 10002 },
          { x: 10000, y: 10002 },
        ],
      };
      const invalid = { ...source, points: [...source.points].reverse() };
      const refinements: number[] = [];
      const trigger: FinishedContour = {
        source,
        baseline: source,
        polyline: invalid,
        refine: (amount) => {
          if (refinements.length === 0) {
            coordinateReads = 0;
            contains.mockClear();
          }
          refinements.push(amount);
          return invalid;
        },
      };
      const fixed = Array.from({ length: kind === 'detailed' ? 1 : 24 }, (_, index) => {
        const radius = kind === 'detailed' ? 100 : 200 + index * 12;
        const read = (): void => {
          coordinateReads += 1;
        };
        const original = circle(radius, kind === 'detailed' ? 4096 : 128, read);
        const candidate = kind === 'detailed' ? original : circle(radius * 0.998, 128, read);
        return {
          source: original,
          baseline: original,
          polyline: candidate,
          refine: vi.fn(() => original),
        };
      });

      const result = runTraceSteps(preserveContourTopologySteps([trigger, ...fixed]));
      expect(result[0]).toBe(source);
      fixed.forEach((contour, index) => {
        expect(result[index + 1]).toBe(contour.polyline);
        expect(contour.refine).not.toHaveBeenCalled();
      });
      // ADR-371 stops the halving after four steps (1/16 of the tolerance).
      expect(refinements).toEqual(Array.from({ length: 4 }, (_, index) => 0.5 ** (index + 1)));
      // These budgets isolate the five warm repair rounds, after initial preparation.
      const vertices = fixed.reduce((sum, contour) => sum + contour.polyline.points.length, 0);
      expect(coordinateReads).toBeLessThanOrEqual(vertices);
      expect(contains.mock.calls.length).toBeLessThanOrEqual(fixed.length * 4);
    },
  );
});

describe('a ring that meets many others', () => {
  const box = (x0: number, y0: number, x1: number, y1: number): Polyline => ({
    closed: true,
    points: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
  });

  // A long bar whose top edge crosses `count` small squares that cannot move
  // (the first `tall` of them also reach down past its baseline). Its retry
  // and weaker refinements keep the crossing; its baseline clears the short
  // squares and its source clears them all.
  function repairBar(count: number, tall = 0) {
    const source = box(0, 0, 400, 2);
    const baseline = box(0, 0, 400, 5);
    const alternateBaseline = box(0, 0, 400, 5);
    const refine = vi.fn((_amount: number) => box(0, 0, 400, 10.25));
    const retry = vi.fn(() => ({
      polyline: box(0, 0, 400, 10.5),
      baseline: alternateBaseline,
      refine,
    }));
    const bar: FinishedContour = {
      source,
      baseline,
      polyline: box(0, 0, 400, 10),
      refine: () => box(0, 0, 400, 10),
      withoutRebuiltCorners: retry,
    };
    const squares = Array.from({ length: count }, (_, index) => {
      const square = box(10 + 20 * index, index < tall ? 4 : 8, 14 + 20 * index, 12);
      return { source: square, baseline: square, polyline: square, refine: () => square };
    });
    const result = runTraceSteps(preserveContourTopologySteps([bar, ...squares]));
    return { result, source, baseline, alternateBaseline, refine, retry, squares };
  }

  it('goes straight to its baseline, without the retry or the weaker refinements', () => {
    const { result, baseline, retry, refine, squares } = repairBar(8);
    expect(result[0]).toBe(baseline);
    expect(retry).not.toHaveBeenCalled();
    expect(refine).not.toHaveBeenCalled();
    squares.forEach((square, index) => expect(result[index + 1]).toBe(square.polyline));
  });

  it('never takes the retry later, which would move it back up from its baseline', () => {
    // Its baseline still meets three squares, too few to be crowded.
    const { result, source, retry } = repairBar(8, 3);
    expect(result[0]).toBe(source);
    expect(retry).not.toHaveBeenCalled();
  });

  it('still takes the retry and the weaker refinements when it meets fewer', () => {
    const { result, alternateBaseline, retry, refine } = repairBar(7);
    expect(result[0]).toBe(alternateBaseline);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(refine.mock.calls.map(([amount]) => amount)).toEqual([0.5, 0.25, 0.125, 0.0625]);
  });
});
