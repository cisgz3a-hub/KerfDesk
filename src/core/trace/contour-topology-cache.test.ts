import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Polyline } from '../scene';
import { contourBox, unionContourBoxes } from './contour-bounds';
import { ContourMembership } from './contour-membership';
import { insideContour } from './contour-orientation';
import {
  ContourMeasurements,
  ContourNestingRelations,
  type TopologyBoundary,
} from './contour-topology-cache';
import { runTraceSteps } from './trace-steps';

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
function owner(index: number, source: Polyline, candidate = source): TopologyBoundary {
  return { index, source, candidate };
}
function changed(a: TopologyBoundary, b: TopologyBoundary): boolean {
  const direction = (first: TopologyBoundary, second: TopologyBoundary): boolean => {
    const source = first.source.points[0];
    const candidate = first.candidate.points[0];
    return (
      source !== undefined &&
      candidate !== undefined &&
      insideContour(source, second.source.points) !==
        insideContour(candidate, second.candidate.points)
    );
  };
  return direction(a, b) || direction(b, a);
}

afterEach(() => vi.restoreAllMocks());

describe('cached nesting relationships', () => {
  it('rechecks a replacement boundary with unchanged bounds', () => {
    const inner = owner(0, square(1.5, 2, 0.2));
    const outer = owner(1, square(0, 0, 4));
    const notch: Polyline = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 3, y: 4 },
        { x: 3, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 4 },
        { x: 0, y: 4 },
      ],
    };
    expect(contourBox(notch.points)).toEqual(contourBox(outer.source.points));
    const relations = new ContourNestingRelations();
    const membership = new ContourMembership();
    for (const candidate of [outer.source, notch, outer.source]) {
      const boundary = { ...outer, candidate };
      expect(runTraceSteps(relations.changedSteps(inner, boundary, membership))).toBe(
        changed(inner, boundary),
      );
    }
    expect(changed(inner, { ...outer, candidate: notch })).toBe(true);
  });

  it('rechecks a replacement first point and distinguishes duplicate geometry owners', () => {
    const source: Polyline = {
      closed: true,
      points: [...square(0, 0, 4).points.slice(0, 3), { x: 2, y: 2 }, { x: 0, y: 4 }],
    };
    const rotated = {
      ...source,
      points: [...source.points.slice(3), ...source.points.slice(0, 3)],
    };
    const boundary = owner(1, square(1.5, 1.5, 1));
    const relations = new ContourNestingRelations();
    const membership = new ContourMembership();
    for (const first of [owner(0, source), owner(0, source, rotated), owner(2, rotated)]) {
      expect(runTraceSteps(relations.changedSteps(first, boundary, membership))).toBe(
        changed(first, boundary),
      );
    }
    expect(changed(owner(0, source, rotated), boundary)).toBe(true);
    expect(changed(owner(2, rotated), boundary)).toBe(false);
  });

  it('keeps the visitor comparison order when owner indexes run in reverse', () => {
    const first = owner(5, square(0, 0, 4));
    const second = owner(1, square(1, 1, 1));
    const membership = new ContourMembership();
    const contains = vi.spyOn(membership, 'containsSteps');
    const relations = new ContourNestingRelations();
    expect(runTraceSteps(relations.changedSteps(first, second, membership))).toBe(false);
    expect(contains.mock.calls.map(([point]) => point)).toEqual([
      first.source.points[0],
      first.candidate.points[0],
      second.source.points[0],
      second.candidate.points[0],
    ]);
    contains.mockClear();
    expect(runTraceSteps(relations.changedSteps(second, first, membership))).toBe(false);
    expect(contains).not.toHaveBeenCalled();
  });

  it('does not retain partial candidate results after cooperative cancellation', () => {
    const outer = owner(0, {
      closed: true,
      points: Array.from({ length: 512 }, (_, i) => ({
        x: 10 * Math.cos((i * Math.PI) / 256),
        y: 10 * Math.sin((i * Math.PI) / 256),
      })),
    });
    const inner = owner(1, square(0, 0, 1), square(20, 20, 1));
    // Cancel at different source/candidate preparation checkpoints and retry the same pair.
    for (const checkpoint of [1, 4, 8, 12, 16]) {
      const relations = new ContourNestingRelations();
      const membership = new ContourMembership();
      const steps = relations.changedSteps(inner, outer, membership);
      for (let i = 0; i < checkpoint; i += 1) expect(steps.next(true).done).toBe(false);
      steps.return(false);
      expect(runTraceSteps(relations.changedSteps(inner, outer, membership))).toBe(true);
      expect(runTraceSteps(relations.changedSteps(outer, inner, membership))).toBe(true);
    }
  });

  it('continues exact comparisons after bounded pair admission is full', () => {
    const relations = new ContourNestingRelations(2);
    const membership = new ContourMembership();
    const contains = vi.spyOn(membership, 'containsSteps');
    const outer = owner(0, square(-20, -20, 40));
    const inners = Array.from({ length: 6 }, (_, index) =>
      owner(index + 1, square(index, index, 1), square(index + 0.25, index + 0.25, 1)),
    );
    for (const inner of inners)
      expect(runTraceSteps(relations.changedSteps(outer, inner, membership))).toBe(false);
    contains.mockClear();
    for (const inner of inners)
      expect(runTraceSteps(relations.changedSteps(inner, outer, membership))).toBe(false);
    // The admitted pairs reuse their results; every later pair is recomputed in full.
    expect(contains).toHaveBeenCalledTimes(4 * (inners.length - 2));
    const escaped = { ...inners[5]!, candidate: square(50, 50, 1) };
    expect(runTraceSteps(relations.changedSteps(outer, escaped, membership))).toBe(true);
  });

  it('retains the empty-contour query guards', () => {
    const relations = new ContourNestingRelations();
    const membership = new ContourMembership();
    const empty = owner(0, { closed: true, points: [] });
    const boundary = owner(1, square(0, 0, 4));
    expect(runTraceSteps(relations.changedSteps(empty, boundary, membership))).toBe(false);
    expect(runTraceSteps(relations.changedSteps(boundary, empty, membership))).toBe(false);
  });
});

describe('cached contour measurements', () => {
  it('matches concatenated bounds for empty, signed-zero and nonfinite boundaries', () => {
    const inputs = [
      [],
      square(-2, -3, 5).points,
      [{ x: -0, y: 0 }],
      [{ x: 0, y: -0 }],
      [{ x: Infinity, y: -Infinity }],
      [{ x: NaN, y: 2 }],
      [{ x: -1e200, y: 1e-200 }],
    ];
    const measurements = new ContourMeasurements();
    for (const first of inputs) {
      for (const second of inputs) {
        const actual = unionContourBoxes([
          measurements.get(first).bounds,
          measurements.get(second).bounds,
        ]);
        expect(actual).toEqual(contourBox([...first, ...second]));
      }
    }
  });
});
