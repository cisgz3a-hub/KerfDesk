import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION, type ProjectOptimizationSettings } from '../scene';
import {
  closedLoopRing,
  cornerVertexIndices,
  reverseClosedPolyline,
  rotateClosedPolyline,
} from './closed-cut-loop';
import {
  closedCutStartPolicy,
  closedEntryVertices,
  enterClosedSegment,
  type ClosedCutStartPolicy,
} from './closed-cut-start';
import type { CutGroup, CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

type Pt = readonly [number, number];

function closed(...pts: ReadonlyArray<Pt>): CutSegment {
  const first = pts[0];
  if (first === undefined) throw new Error('closed fixture needs a point');
  return { polyline: [...pts, first].map(([x, y]) => ({ x, y })), closed: true };
}

function open(...pts: ReadonlyArray<Pt>): CutSegment {
  return { polyline: pts.map(([x, y]) => ({ x, y })), closed: false };
}

// 20 × 10 rectangle whose drawn start sits mid-way along the bottom edge.
function midEdgeRectangle(x: number, y: number): CutSegment {
  return closed([x + 10, y], [x + 20, y], [x + 20, y + 10], [x, y + 10], [x, y]);
}

function regularPolygon(sides: number, radius: number): CutSegment {
  const pts: Pt[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (2 * Math.PI * i) / sides;
    pts.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  return closed(...pts);
}

function cutJob(segments: ReadonlyArray<CutSegment>): Job {
  const group: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
  };
  return { groups: [group] };
}

function optimizedSegments(
  segments: ReadonlyArray<CutSegment>,
  patch: Partial<ProjectOptimizationSettings> = {},
): ReadonlyArray<CutSegment> {
  const job = optimizePaths(cutJob(segments), { ...DEFAULT_PROJECT_OPTIMIZATION, ...patch });
  const group = job.groups[0];
  if (group?.kind !== 'cut') throw new Error('expected one cut group');
  return group.segments;
}

// Undirected edges as sorted strings: two polylines burn the same geometry
// exactly when these multisets match.
function edgeSet(polyline: ReadonlyArray<{ x: number; y: number }>): string[] {
  const edges: string[] = [];
  for (let i = 1; i < polyline.length; i += 1) {
    const a = polyline[i - 1];
    const b = polyline[i];
    if (a === undefined || b === undefined) continue;
    const ends = [`${a.x},${a.y}`, `${b.x},${b.y}`].sort();
    edges.push(ends.join('|'));
  }
  return edges.sort();
}

const BEST: ClosedCutStartPolicy = {
  bestStartPoint: true,
  preferCorners: false,
  bestDirection: false,
};

describe('closed loop primitives', () => {
  it('rotates and reverses a ring without changing the burned edges', () => {
    const square = closed([0, 0], [10, 0], [10, 10], [0, 10]).polyline;
    const rotated = rotateClosedPolyline(square, 2);
    expect(rotated[0]).toEqual({ x: 10, y: 10 });
    expect(rotated[1]).toEqual({ x: 0, y: 10 });
    expect(rotated[rotated.length - 1]).toEqual({ x: 10, y: 10 });
    expect(edgeSet(rotated)).toEqual(edgeSet(square));
    const reversed = reverseClosedPolyline(rotated);
    expect(reversed[0]).toEqual({ x: 10, y: 10 });
    expect(reversed[1]).toEqual({ x: 10, y: 0 });
    expect(edgeSet(reversed)).toEqual(edgeSet(square));
    expect(rotateClosedPolyline(square, 0)).toBe(square);
    expect(rotateClosedPolyline(square, 9)).toBe(square);
  });

  it('counts a turn of 45 degrees or more as a corner', () => {
    const ring = (sides: number): ReturnType<typeof closedLoopRing> =>
      closedLoopRing(regularPolygon(sides, 20).polyline);
    expect(cornerVertexIndices(ring(4))).toEqual([0, 1, 2, 3]);
    expect(cornerVertexIndices(ring(8))).toHaveLength(8);
    expect(cornerVertexIndices(ring(12))).toEqual([]);
    expect(cornerVertexIndices(closedLoopRing(midEdgeRectangle(0, 0).polyline))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it('skips a duplicated vertex instead of hiding the corner it sits on', () => {
    const ring = closedLoopRing(closed([0, 0], [10, 0], [10, 0], [10, 10], [0, 10]).polyline);
    expect(cornerVertexIndices(ring)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('closed cut start policy', () => {
  it('is off unless a closed-cut option is ticked', () => {
    expect(closedCutStartPolicy({})).toBeNull();
    expect(
      closedCutStartPolicy({ bestStartPoint: false, preferCorners: false, bestDirection: false }),
    ).toBeNull();
    expect(closedCutStartPolicy({ bestDirection: true })).toEqual({
      bestStartPoint: false,
      preferCorners: false,
      bestDirection: true,
    });
  });

  it('offers every vertex, only corners, or the corner nearest the drawn start', () => {
    const rectangle = midEdgeRectangle(0, 0);
    expect(closedEntryVertices(rectangle, BEST)).toEqual([0, 1, 2, 3, 4]);
    expect(closedEntryVertices(rectangle, { ...BEST, preferCorners: true })).toEqual([1, 2, 3, 4]);
    // Corners 1 (20,0) and 4 (0,0) are both 10 mm from the drawn start; the
    // lower ring index wins the tie.
    expect(
      closedEntryVertices(rectangle, { ...BEST, bestStartPoint: false, preferCorners: true }),
    ).toEqual([1]);
    // A curve-like ring has no corner, so Prefer corners falls back.
    const circle = regularPolygon(64, 10);
    expect(closedEntryVertices(circle, { ...BEST, preferCorners: true })).toHaveLength(64);
    expect(
      closedEntryVertices(circle, { ...BEST, bestStartPoint: false, preferCorners: true }),
    ).toEqual([0]);
  });

  it('never moves an operator-set start or an open path', () => {
    const locked: CutSegment = { ...midEdgeRectangle(0, 0), startLocked: true };
    expect(closedEntryVertices(locked, { ...BEST, preferCorners: true })).toEqual([0]);
    const policy = { ...BEST, bestDirection: true };
    expect(enterClosedSegment(locked, 3, { x: -50, y: -50 }, policy)).toBe(locked);
    const path = open([0, 0], [5, 5]);
    expect(enterClosedSegment(path, 1, { x: -50, y: -50 }, policy)).toBe(path);
  });
});

describe('optimizePaths closed-cut starts', () => {
  it('keeps the drawn starts when every option is off, explicitly or by omission', () => {
    const segments = [midEdgeRectangle(0, 0), midEdgeRectangle(40, 0), open([90, 0], [95, 5])];
    const legacy = optimizedSegments(segments);
    expect(
      optimizedSegments(segments, {
        bestStartPoint: false,
        preferCorners: false,
        bestDirection: false,
      }),
    ).toEqual(legacy);
    expect(legacy.map((segment) => segment.polyline[0])).toEqual([
      { x: 10, y: 0 },
      { x: 50, y: 0 },
      { x: 90, y: 0 },
    ]);
  });

  it('enters each closed cut at the vertex nearest the previous cut end', () => {
    const [first, second] = optimizedSegments(
      [midEdgeRectangle(0, 0), closed([60, 10], [40, 10], [40, 0], [60, 0])],
      { bestStartPoint: true },
    );
    // From the origin the nearest vertex of the first rectangle is its corner
    // (0,0); the second shape, drawn from its far corner, is then entered at
    // its vertex nearest there.
    expect(first?.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(second?.polyline[0]).toEqual({ x: 40, y: 0 });
    expect(second?.polyline[second.polyline.length - 1]).toEqual({ x: 40, y: 0 });
  });

  it('snaps to the nearest sharp corner and falls back on smooth loops', () => {
    // A vertex mid-way along the bottom edge, straight above the head, is
    // nearer than any corner; Prefer corners passes it over. The two bottom
    // corners tie, and the lower ring index wins.
    const rectangle = closed([-20, 30], [-20, 20], [0, 20], [20, 20], [20, 30]);
    const [nearest] = optimizedSegments([rectangle], { bestStartPoint: true });
    expect(nearest?.polyline[0]).toEqual({ x: 0, y: 20 });
    const [corner] = optimizedSegments([rectangle], { bestStartPoint: true, preferCorners: true });
    expect(corner?.polyline[0]).toEqual({ x: -20, y: 20 });
    const circle = regularPolygon(64, 10);
    const [smooth] = optimizedSegments([circle], { bestStartPoint: true, preferCorners: true });
    // No corners: the nearest of all 64 vertices to the origin-side seed.
    expect(smooth?.polyline[0]).toBeDefined();
    expect(edgeSet(smooth?.polyline ?? [])).toEqual(edgeSet(circle.polyline));
  });

  it('reverses a closed cut only when Choose best direction is on', () => {
    // The head travels straight up the Y axis to (0,50). Drawn, the cut turns
    // 90 degrees onto +x; reversed it carries straight on up the left edge.
    const square = closed([0, 50], [10, 50], [10, 60], [0, 60]);
    const [drawn] = optimizedSegments([square]);
    expect(drawn?.polyline[1]).toEqual({ x: 10, y: 50 });
    const [chosen] = optimizedSegments([square], { bestDirection: true });
    expect(chosen?.polyline[0]).toEqual({ x: 0, y: 50 });
    expect(chosen?.polyline[1]).toEqual({ x: 0, y: 60 });
    expect(edgeSet(chosen?.polyline ?? [])).toEqual(edgeSet(square.polyline));
    // Approaching (10,10) diagonally, +x and +y bend equally: an exact tie
    // keeps the drawn direction.
    const diagonal = closed([10, 10], [20, 10], [20, 20], [10, 20]);
    const [tied] = optimizedSegments([diagonal], { bestDirection: true });
    expect(tied?.polyline[1]).toEqual({ x: 20, y: 10 });
  });

  it('never changes the burned geometry, only the entry', () => {
    const segments = [
      midEdgeRectangle(0, 0),
      regularPolygon(6, 8),
      closed([50, 50], [70, 50], [60, 65]),
      open([100, 0], [110, 10]),
    ];
    const before = segments.map((segment) => edgeSet(segment.polyline)).sort();
    for (const patch of [
      { bestStartPoint: true },
      { bestStartPoint: true, preferCorners: true },
      { preferCorners: true },
      { bestStartPoint: true, bestDirection: true },
      { travelPolicy: 'source-order' as const, bestStartPoint: true, bestDirection: true },
    ]) {
      const after = optimizedSegments(segments, patch);
      expect(after.map((segment) => edgeSet(segment.polyline)).sort()).toEqual(before);
      for (const segment of after.filter((candidate) => candidate.closed)) {
        expect(segment.polyline[0]).toEqual(segment.polyline[segment.polyline.length - 1]);
      }
    }
  });

  it('keeps source order but still moves each closed start to follow the head', () => {
    const segments = [midEdgeRectangle(40, 0), midEdgeRectangle(0, 0)];
    const after = optimizedSegments(segments, {
      travelPolicy: 'source-order',
      bestStartPoint: true,
      preferCorners: true,
    });
    // Visiting order stays as drawn (the far rectangle first).
    expect(after[0]?.polyline[0]).toEqual({ x: 40, y: 0 });
    expect(after[1]?.polyline[0]).toEqual({ x: 20, y: 0 });
  });

  it('leaves an operator-set start where compile put it', () => {
    const locked: CutSegment = { ...midEdgeRectangle(30, 30), startLocked: true };
    const [placed] = optimizedSegments([locked], {
      bestStartPoint: true,
      preferCorners: true,
      bestDirection: true,
    });
    expect(placed).toBe(locked);
  });
});
