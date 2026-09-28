// LBG-C04: which vertices a closed shape may start at, and which of them are
// corners. Fixtures are polylines in mm; a closed one ends on its first point.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import {
  closedPolylineCorners,
  closedStartCandidates,
  nearestClosedStart,
} from './closed-shape-start';
import { withCutArcMoves } from './cut-arc-moves';
import type { CutSegment } from './job';

function closed(points: ReadonlyArray<readonly [number, number]>): CutSegment {
  const polyline = points.map(([x, y]) => ({ x, y }));
  return { closed: true, polyline: [...polyline, polyline[0] as Vec2] };
}

/** `count` vertices round a circle, the first at angle `phase` (radians). */
function circlePoints(cx: number, cy: number, r: number, count: number, phase = 0) {
  return Array.from({ length: count }, (_, i): readonly [number, number] => {
    const angle = phase + (2 * Math.PI * i) / count;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

/** A quarter circle from `startDeg` to `startDeg + 90`, both ends included. */
function quarter(cx: number, cy: number, r: number, startDeg: number, steps: number) {
  return Array.from({ length: steps + 1 }, (_, i): readonly [number, number] => {
    const angle = ((startDeg + (90 * i) / steps) * Math.PI) / 180;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  });
}

/** A 40 x 20 rectangle at the origin with corner radius `r`, drawn from the
 * middle of its bottom edge, each fillet in `steps` chords. */
function roundedRect(r: number, steps: number): CutSegment {
  return closed([
    [20, 0],
    ...quarter(40 - r, r, r, -90, steps),
    ...quarter(40 - r, 20 - r, r, 0, steps),
    ...quarter(r, 20 - r, r, 90, steps),
    ...quarter(r, r, r, 180, steps),
  ]);
}

describe('closedPolylineCorners', () => {
  it('finds the four corners of a rectangle and not a mid-edge start', () => {
    const rectangle = closed([
      [5, 0],
      [10, 0],
      [10, 5],
      [0, 5],
      [0, 0],
    ]);
    expect(closedPolylineCorners(rectangle.polyline)).toEqual([1, 2, 3, 4]);
  });

  it('finds no corner on a circle, however densely it is sampled', () => {
    for (const count of [64, 720, 20_000]) {
      expect(closedPolylineCorners(closed(circlePoints(0, 0, 10, count)).polyline)).toEqual([]);
    }
  });

  it('finds no corner on a smoothly rounded rectangle', () => {
    for (const steps of [6, 40, 400]) {
      expect(closedPolylineCorners(roundedRect(3, steps).polyline)).toEqual([]);
    }
  });

  it('reads a fillet far below the window as the corner it rounds', () => {
    // 0.01 mm radius: each corner is a few vertices a hair apart.
    const corners = closedPolylineCorners(roundedRect(0.01, 3).polyline);
    expect(corners.length).toBeGreaterThanOrEqual(4);
    expect(corners.length).toBeLessThanOrEqual(16);
  });

  it('finds where the straight edge of a D meets its arc', () => {
    // Drawn from the top of the arc: 90 steps over the half turn, then the flat.
    const arc = Array.from({ length: 91 }, (_, i): readonly [number, number] => {
      const angle = ((90 + i) * Math.PI) / 180;
      return [20 + 10 * Math.cos(angle), 10 + 10 * Math.sin(angle)];
    });
    const rest = Array.from({ length: 90 }, (_, i): readonly [number, number] => {
      const angle = (i * Math.PI) / 180;
      return [20 + 10 * Math.cos(angle), 10 + 10 * Math.sin(angle)];
    });
    const d = closed([...arc, ...rest]);
    const corners = closedPolylineCorners(d.polyline);
    expect(corners.map((index) => d.polyline[index])).toEqual([
      { x: 10, y: 10 + 10 * Math.sin(Math.PI) },
      { x: 30, y: 10 },
    ]);
  });

  it('is empty for a degenerate loop', () => {
    expect(closedPolylineCorners([])).toEqual([]);
    expect(closedPolylineCorners(closed([[1, 1]]).polyline)).toEqual([]);
    expect(closedPolylineCorners(closed(circlePoints(0, 0, 0.01, 8)).polyline)).toEqual([]);
  });
});

describe('closedStartCandidates', () => {
  const rectangle = closed([
    [5, 0],
    [10, 0],
    [10, 5],
    [0, 5],
    [0, 0],
  ]);

  it('offers only the drawn start for drawn, for open paths and for tiny loops', () => {
    expect(closedStartCandidates(rectangle, 'drawn')).toEqual([0]);
    expect(closedStartCandidates({ ...rectangle, closed: false }, 'nearest')).toEqual([0]);
    expect(closedStartCandidates(closed([[1, 1]]), 'nearest-corner')).toEqual([0]);
  });

  it('offers every vertex for nearest and only corners for nearest-corner', () => {
    expect(closedStartCandidates(rectangle, 'nearest')).toEqual([0, 1, 2, 3, 4]);
    expect(closedStartCandidates(rectangle, 'nearest-corner')).toEqual([1, 2, 3, 4]);
  });

  it('falls back to every vertex when a shape has no corner', () => {
    const circle = closed(circlePoints(0, 0, 10, 36));
    expect(closedStartCandidates(circle, 'nearest-corner')).toEqual(
      closedStartCandidates(circle, 'nearest'),
    );
    expect(closedStartCandidates(circle, 'nearest')).toHaveLength(36);
  });

  it('never offers a vertex with a non-finite coordinate', () => {
    const broken = closed([
      [0, 0],
      [Number.NaN, 0],
      [10, 10],
    ]);
    expect(closedStartCandidates(broken, 'nearest')).toEqual([0, 2]);
  });

  it('offers a segment with arc moves only the vertices its moves end on', () => {
    // The right side bulges as one arc through a chord vertex at (12, 5): a
    // move ends on every other vertex, but none on that one.
    const bulged = closed([
      [0, 0],
      [10, 0],
      [12, 5],
      [10, 10],
      [0, 10],
    ]);
    const withArcs = withCutArcMoves(bulged, [
      { kind: 'line', to: { x: 10, y: 0 } },
      { kind: 'arc', to: { x: 10, y: 10 }, center: { x: 5, y: 5 }, clockwise: false },
      { kind: 'line', to: { x: 0, y: 10 } },
      { kind: 'line', to: { x: 0, y: 0 } },
    ]);
    expect(withArcs.arcMoves).toBeDefined();
    expect(closedStartCandidates(bulged, 'nearest')).toEqual([0, 1, 2, 3, 4]);
    expect(closedStartCandidates(withArcs, 'nearest')).toEqual([0, 1, 3, 4]);
    expect(closedStartCandidates(withArcs, 'nearest-corner')).toEqual([0, 1, 3, 4]);
  });
});

describe('nearestClosedStart', () => {
  it('picks the candidate nearest the cursor and the lowest index on a tie', () => {
    const square = closed([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(nearestClosedStart(square, { x: 11, y: 12 }, 'nearest')).toBe(2);
    expect(nearestClosedStart(square, { x: 5, y: 5 }, 'nearest')).toBe(0);
    expect(nearestClosedStart(square, { x: 10, y: 5 }, 'nearest')).toBe(1);
    expect(nearestClosedStart(square, { x: 11, y: 12 }, 'drawn')).toBe(0);
  });
});
