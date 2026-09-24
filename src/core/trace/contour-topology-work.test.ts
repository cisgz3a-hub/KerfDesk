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
