import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../scene';
import { estimateJobDuration } from './estimate-duration';
import type { CutGroup, CutSegment, FillGroup, FillSegment, Job } from './job';
import { MAX_NEAREST_NEIGHBOR_SEGMENTS, optimizePaths } from './optimize-paths';

// All fixtures in this file produce CutGroups; narrow on the union
// for ergonomic field access in the assertions below.
function asCut(j: Job, i = 0): CutGroup | undefined {
  const g = j.groups[i];
  if (g === undefined || g.kind !== 'cut') return undefined;
  return g;
}

function seg(...pts: Array<[number, number]>): CutSegment {
  return { polyline: pts.map(([x, y]) => ({ x, y })), closed: false };
}

function fillSeg(...pts: Array<[number, number]>): FillSegment {
  return { ...seg(...pts), reverse: false };
}

function closedSeg(...pts: Array<[number, number]>): CutSegment {
  // Closed: last == first by construction
  const first = pts[0];
  if (first === undefined) throw new Error('test fixture: closed seg needs >= 1 pt');
  return { polyline: [...pts, first].map(([x, y]) => ({ x, y })), closed: true };
}

function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
  };
}

function fillGroup(
  fillStyle: NonNullable<FillGroup['fillStyle']>,
  segments: ReadonlyArray<FillSegment>,
  overrides: Partial<Omit<FillGroup, 'kind' | 'fillStyle' | 'segments'>> = {},
): FillGroup {
  return {
    kind: 'fill',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    fillStyle,
    overscanMm: 0,
    segments,
    ...overrides,
  };
}

function asFill(j: Job, i = 0): FillGroup | undefined {
  const g = j.groups[i];
  if (g === undefined || g.kind !== 'fill') return undefined;
  return g;
}

describe('optimizePaths', () => {
  it('returns the empty job unchanged', () => {
    expect(optimizePaths({ groups: [] })).toEqual({ groups: [] });
  });

  it('returns single-segment groups unchanged (no choice to make)', () => {
    const j: Job = { groups: [group([seg([0, 0], [10, 0])])] };
    expect(optimizePaths(j)).toEqual(j);
  });

  it('reorders two segments so the closer one is visited first', () => {
    // Original order visits the far segment first (bad). Optimizer
    // should swap so we visit (0,0)→(1,0) before the segment 100mm away.
    const j: Job = {
      groups: [
        group([
          seg([100, 100], [101, 100]), // far first (bad)
          seg([0, 0], [1, 0]), // close, should go first
        ]),
      ],
    };
    const result = optimizePaths(j);
    const firstSeg = asCut(result)?.segments[0];
    expect(firstSeg?.polyline[0]).toEqual({ x: 0, y: 0 });
  });

  it('preserves source order when that travel policy is selected', () => {
    const far = seg([100, 100], [101, 100]);
    const near = seg([0, 0], [1, 0]);
    const result = optimizePaths(
      { groups: [group([far, near])] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, travelPolicy: 'source-order' },
    );

    expect(asCut(result)?.segments).toEqual([far, near]);
  });

  it('preserves open-path direction when reversal is disabled', () => {
    const backwards = seg([10, 0], [0, 0]);
    const result = optimizePaths(
      { groups: [group([backwards])] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, pathDirection: 'preserve' },
    );

    expect(asCut(result)?.segments[0]?.polyline).toEqual(backwards.polyline);
  });

  it('can reverse layer priority without changing order inside each layer', () => {
    const first = group([seg([0, 0], [1, 0])]);
    const second = { ...group([seg([2, 0], [3, 0])]), layerId: 'L2' };
    const result = optimizePaths(
      { groups: [first, second] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, layerPriority: 'reverse-project-order' },
    );

    expect(result.groups.map((candidate) => candidate.layerId)).toEqual(['L2', 'L1']);
  });

  it('never reverses artwork priority when reversing operations', () => {
    const a1 = { ...group([seg([0, 0], [1, 0])]), layerId: 'L1', sourceObjectId: 'A' };
    const a2 = { ...group([seg([2, 0], [3, 0])]), layerId: 'L2', sourceObjectId: 'A' };
    const b1 = { ...group([seg([4, 0], [5, 0])]), layerId: 'L1', sourceObjectId: 'B' };
    const b2 = { ...group([seg([6, 0], [7, 0])]), layerId: 'L2', sourceObjectId: 'B' };

    const result = optimizePaths(
      { groups: [a1, a2, b1, b2] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, layerPriority: 'reverse-project-order' },
    );

    expect(result.groups.map((candidate) => [candidate.sourceObjectId, candidate.layerId])).toEqual(
      [
        ['A', 'L2'],
        ['A', 'L1'],
        ['B', 'L2'],
        ['B', 'L1'],
      ],
    );
  });

  it('uses the selected planning start point as the nearest-neighbor seed', () => {
    const farFirst = seg([100, 0], [101, 0]);
    const nearSecond = seg([0, 0], [1, 0]);
    const result = optimizePaths(
      { groups: [group([farFirst, nearSecond])] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, startPoint: 'job-center' },
    );

    expect(asCut(result)?.segments[0]).toEqual(farFirst);
  });

  it('can disable inside-first ordering', () => {
    const outer = closedSeg([0, 0], [10, 0], [10, 10], [0, 10]);
    const inner = closedSeg([4, 4], [6, 4], [6, 6], [4, 6]);
    const result = optimizePaths(
      { groups: [group([outer, inner])] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, insideFirst: false },
    );

    expect(asCut(result)?.segments[0]).toEqual(outer);
  });

  it('leaves scanline fill groups in source order', () => {
    const farFirst = { ...seg([100, 100], [101, 100]), reverse: false };
    const nearSecond = { ...seg([0, 0], [1, 0]), reverse: false };
    const j: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'L1',
          color: '#000',
          power: 50,
          speed: 1000,
          passes: 1,
          airAssist: false,
          fillStyle: 'scanline',
          overscanMm: 0,
          segments: [farFirst, nearSecond],
        },
      ],
    };

    const result = optimizePaths(j);

    expect(result.groups[0]).toBe(j.groups[0]);
  });

  it('reorders offset fill contours to enter the closest contour first', () => {
    const farFirst = fillSeg([100, 100], [101, 100]);
    const nearSecond = fillSeg([0, 0], [1, 0]);
    const j: Job = {
      groups: [fillGroup('offset', [farFirst, nearSecond])],
    };

    const result = optimizePaths(j);

    expect(asFill(result)?.segments[0]).toBe(nearSecond);
    expect(asFill(result)?.segments[1]).toBe(farFirst);
  });

  it('reorders compatible island fill groups to reduce travel', () => {
    const farIsland = fillGroup('island', [fillSeg([100, 100], [101, 100])]);
    const nearIsland = fillGroup('island', [fillSeg([0, 0], [1, 0])]);
    const j: Job = { groups: [farIsland, nearIsland] };

    const before = estimateJobDuration(j, DEFAULT_DEVICE_PROFILE);
    const result = optimizePaths(j);
    const after = estimateJobDuration(result, DEFAULT_DEVICE_PROFILE);

    expect(result.groups).toEqual([nearIsland, farIsland]);
    expect(after.breakdown.travelSeconds).toBeLessThan(before.breakdown.travelSeconds);
  });

  it('does not reorder island fill groups across incompatible layer settings', () => {
    const farLayer = fillGroup('island', [fillSeg([100, 100], [101, 100])], {
      layerId: 'L2',
    });
    const nearLayer = fillGroup('island', [fillSeg([0, 0], [1, 0])], {
      layerId: 'L1',
    });
    const j: Job = { groups: [farLayer, nearLayer] };

    const result = optimizePaths(j);

    expect(result.groups).toEqual([farLayer, nearLayer]);
  });

  it('does not reorder island fill groups across different motion policies', () => {
    const farAdaptive = fillGroup('island', [fillSeg([100, 100], [101, 100])]);
    const nearSensitive = fillGroup('island', [fillSeg([0, 0], [1, 0])], {
      islandMotionPolicy: 'sensitive',
    });
    const j: Job = { groups: [farAdaptive, nearSensitive] };

    const result = optimizePaths(j);

    expect(result.groups).toEqual([farAdaptive, nearSensitive]);
  });

  it('leaves very large groups in source order instead of running the O(n^2) pass', () => {
    const farFirst = seg([100, 100], [101, 100]);
    const nearSecond = seg([0, 0], [1, 0]);
    const filler = Array.from({ length: MAX_NEAREST_NEIGHBOR_SEGMENTS - 1 }, (_, i) =>
      seg([200 + i, 0], [201 + i, 0]),
    );
    const j: Job = { groups: [group([farFirst, nearSecond, ...filler])] };

    const result = optimizePaths(j);

    expect(asCut(result)?.segments).toBe(asCut(j)?.segments);
    expect(asCut(result)?.segments[0]).toBe(farFirst);
    expect(asCut(result)?.segments[1]).toBe(nearSecond);
  });

  it('flips an open segment to enter from the nearer endpoint', () => {
    // Cursor starts at origin. Segment goes from (50,0) to (10,0).
    // Entering at (50,0) costs 50mm; entering at (10,0) costs 10mm
    // (reversed). Optimizer should pick the reversed direction.
    const j: Job = {
      groups: [group([seg([50, 0], [10, 0])])],
    };
    const result = optimizePaths(j);
    const firstPoint = asCut(result)?.segments[0]?.polyline[0];
    expect(firstPoint).toEqual({ x: 10, y: 0 });
  });

  it('does NOT flip a closed segment (start == end, no win)', () => {
    // Closed loop: (0,0) → (10,0) → (10,10) → (0,10) → (0,0). The
    // first point is (0,0) — closest to origin. No reversal needed.
    const j: Job = {
      groups: [group([closedSeg([0, 0], [10, 0], [10, 10], [0, 10])])],
    };
    const result = optimizePaths(j);
    const firstSeg = asCut(result)?.segments[0];
    expect(firstSeg?.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(firstSeg?.closed).toBe(true);
    // Polyline orientation preserved (not reversed)
    expect(firstSeg?.polyline[1]).toEqual({ x: 10, y: 0 });
  });

  it('cuts contained closed contours before their containing outer contour', () => {
    const outer = closedSeg([0, 0], [100, 0], [100, 100], [0, 100]);
    const inner = closedSeg([40, 40], [60, 40], [60, 60], [40, 60]);
    const j: Job = {
      groups: [group([outer, inner])],
    };

    const result = optimizePaths(j);

    expect(asCut(result)?.segments[0]).toEqual(inner);
    expect(asCut(result)?.segments[1]).toEqual(outer);
  });

  it('property: optimization preserves every cut segment', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 1, max: 400, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: 1, max: 400, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: 1, max: 400, noNaN: true, noDefaultInfinity: true }),
            fc.double({ min: 1, max: 400, noNaN: true, noDefaultInfinity: true }),
          ),
          { minLength: 2, maxLength: 12 },
        ),
        (rawSegs) => {
          const segments: CutSegment[] = rawSegs.map(([ax, ay, bx, by]) => ({
            polyline: [
              { x: ax, y: ay },
              { x: bx, y: by },
            ],
            closed: false,
          }));
          const job: Job = { groups: [group(segments)] };
          const optimized = asCut(optimizePaths(job))?.segments ?? [];
          const canonical = (segment: CutSegment): string => {
            const forward = JSON.stringify(segment.polyline);
            const reverse = JSON.stringify([...segment.polyline].reverse());
            return `${String(segment.closed)}:${forward < reverse ? forward : reverse}`;
          };
          expect(optimized.map(canonical).sort()).toEqual(segments.map(canonical).sort());
        },
      ),
      { numRuns: 50 },
    );
  });

  it('reflects connected-cut continuity after path optimization', () => {
    const job: Job = {
      groups: [group([seg([10, 0], [20, 0]), seg([0, 0], [10, 0])])],
    };
    const before = estimateJobDuration(job, DEFAULT_DEVICE_PROFILE);
    const after = estimateJobDuration(optimizePaths(job), DEFAULT_DEVICE_PROFILE);
    // Optimization joins the two collinear cuts. With no intervening laser-off
    // travel, the motion planner carries junction speed across the shared point.
    expect(after.breakdown.cutSeconds).toBeLessThan(before.breakdown.cutSeconds);
  });

  it('improves travel on a deliberately bad ordering (concrete fixture)', () => {
    // Four 1mm cuts arranged at the corners of a 100mm box, presented
    // in worst-case order (zigzag across the box every time). NN
    // should walk the perimeter — large measurable improvement, not
    // a microscopic edge case. This is what the optimizer is for.
    const j: Job = {
      groups: [
        group([
          seg([0, 0], [1, 0]),
          seg([100, 100], [101, 100]),
          seg([0, 100], [1, 100]),
          seg([100, 0], [101, 0]),
        ]),
      ],
    };
    const before = estimateJobDuration(j, DEFAULT_DEVICE_PROFILE);
    const after = estimateJobDuration(optimizePaths(j), DEFAULT_DEVICE_PROFILE);
    // Concrete win: NN picks the perimeter walk on this fixture, which
    // is the optimal tour. Improvement vs zigzag original is ~17%.
    // Use 10% as the floor so the contract is "visible improvement,"
    // not "exact percentage" (the percentage depends on which corners
    // get hit first by the greedy step).
    expect(after.breakdown.travelSeconds).toBeLessThan(before.breakdown.travelSeconds * 0.9);
  });

  it('honest about NN limits — may pessimize tiny amounts on pathological 2-segment inputs', () => {
    // Known weakness: NN minimizes per-step travel without
    // considering the postamble back to origin. With one tiny near-
    // origin cut and one long far cut, the original order (long-
    // travel-out, end-at-origin) beats NN's (short-travel-out,
    // end-far-from-origin, long-postamble) by exactly the length of
    // the tiny cut. Documented limit; full 2-opt with reversal is
    // the Phase D refinement that closes this gap.
    const j: Job = {
      groups: [
        group([
          seg([0, 0], [0.001, 0]), // tiny cut at origin
          seg([0, 100], [0, 0]), // long cut ending at origin
        ]),
      ],
    };
    const before = estimateJobDuration(j, DEFAULT_DEVICE_PROFILE);
    const after = estimateJobDuration(optimizePaths(j), DEFAULT_DEVICE_PROFILE);
    // Real-world tolerance: any pessimization should be tiny
    // (under 1mm of extra travel). This caps the worst case so a
    // future regression in the heuristic doesn't sneak through.
    const extraTravelMm =
      (after.breakdown.travelSeconds - before.breakdown.travelSeconds) *
      (DEFAULT_DEVICE_PROFILE.maxFeed / 60);
    expect(extraTravelMm).toBeLessThan(1);
  });

  it('property: optimization is idempotent — running it twice == running once', () => {
    // Once nearest-neighbor has produced an order, running it again
    // on that order should produce the same order (the greedy choice
    // at each step is the same).
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 400, noNaN: true }),
            fc.double({ min: 0, max: 400, noNaN: true }),
          ),
          { minLength: 2, maxLength: 8 },
        ),
        (pts) => {
          const segments: CutSegment[] = pts.map(([x, y]) => ({
            polyline: [
              { x, y },
              { x: x + 5, y: y + 5 },
            ],
            closed: false,
          }));
          const job: Job = { groups: [group(segments)] };
          const once = optimizePaths(job);
          const twice = optimizePaths(once);
          expect(twice).toEqual(once);
        },
      ),
      { numRuns: 30 },
    );
  });

  it('property: determinism — same input produces same output across calls', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.double({ min: 0, max: 400, noNaN: true }),
            fc.double({ min: 0, max: 400, noNaN: true }),
          ),
          { minLength: 2, maxLength: 10 },
        ),
        (pts) => {
          const segments: CutSegment[] = pts.map(([x, y]) => ({
            polyline: [
              { x, y },
              { x: x + 1, y: y + 1 },
            ],
            closed: false,
          }));
          const job: Job = { groups: [group(segments)] };
          const a = optimizePaths(job);
          const b = optimizePaths(job);
          expect(a).toEqual(b);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('preserves group metadata (color, power, speed, passes, layerId)', () => {
    const original = group([seg([10, 10], [20, 20]), seg([0, 0], [5, 5])]);
    const j: Job = { groups: [{ ...original, passes: 3, power: 75, speed: 1500 }] };
    const result = optimizePaths(j);
    const g = asCut(result);
    expect(g?.layerId).toBe('L1');
    expect(g?.color).toBe('#000');
    expect(g?.power).toBe(75);
    expect(g?.speed).toBe(1500);
    expect(g?.passes).toBe(3);
  });

  it('preserves cut content (same set of polylines, possibly reordered/reversed)', () => {
    // Optimization cannot drop or duplicate any cut.
    const j: Job = {
      groups: [group([seg([10, 10], [20, 20]), seg([30, 30], [40, 40]), seg([5, 5], [15, 15])])],
    };
    const result = optimizePaths(j);
    expect(asCut(result)?.segments.length).toBe(3);
  });
});
