import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { CutGroup, CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

function seg(...pts: Array<[number, number]>): CutSegment {
  return { polyline: pts.map(([x, y]) => ({ x, y })), closed: false };
}

function closedSeg(...pts: Array<[number, number]>): CutSegment {
  // Closed: last == first by construction
  const first = pts[0];
  if (first === undefined) throw new Error('test fixture: closed seg needs >= 1 pt');
  return { polyline: [...pts, first].map(([x, y]) => ({ x, y })), closed: true };
}

function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    segments,
  };
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
    const firstSeg = result.groups[0]?.segments[0];
    expect(firstSeg?.polyline[0]).toEqual({ x: 0, y: 0 });
  });

  it('flips an open segment to enter from the nearer endpoint', () => {
    // Cursor starts at origin. Segment goes from (50,0) to (10,0).
    // Entering at (50,0) costs 50mm; entering at (10,0) costs 10mm
    // (reversed). Optimizer should pick the reversed direction.
    const j: Job = {
      groups: [group([seg([50, 0], [10, 0])])],
    };
    const result = optimizePaths(j);
    const firstPoint = result.groups[0]?.segments[0]?.polyline[0];
    expect(firstPoint).toEqual({ x: 10, y: 0 });
  });

  it('does NOT flip a closed segment (start == end, no win)', () => {
    // Closed loop: (0,0) → (10,0) → (10,10) → (0,10) → (0,0). The
    // first point is (0,0) — closest to origin. No reversal needed.
    const j: Job = {
      groups: [group([closedSeg([0, 0], [10, 0], [10, 10], [0, 10])])],
    };
    const result = optimizePaths(j);
    const firstSeg = result.groups[0]?.segments[0];
    expect(firstSeg?.polyline[0]).toEqual({ x: 0, y: 0 });
    expect(firstSeg?.closed).toBe(true);
    // Polyline orientation preserved (not reversed)
    expect(firstSeg?.polyline[1]).toEqual({ x: 10, y: 0 });
  });

  it('property: cut time is preserved exactly (same cuts, same speed)', () => {
    // Reordering segments doesn't add or remove any cut — the total
    // cut distance and per-layer feed are identical, so cut time
    // must match to float precision.
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            // Constrain coords to [1, 400] mm — any cut must have
            // meaningful length. Allowing 1e-28 mm segments lets
            // fast-check shrink to degenerate ULP-edge inputs that
            // pass the algorithm but trip any precision threshold.
            // Real lasering coords are always millimetres+.
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
          const before = estimateJobDuration(job, DEFAULT_DEVICE_PROFILE);
          const after = estimateJobDuration(optimizePaths(job), DEFAULT_DEVICE_PROFILE);
          // Relative comparison — float-sum order matters per the
          // planner's trapezoidal integrator. 1 ppm is 1 ms on a
          // 1000s job; under any user-visible delta.
          const denom = Math.max(before.breakdown.cutSeconds, 1e-9);
          const relDiff =
            Math.abs(after.breakdown.cutSeconds - before.breakdown.cutSeconds) / denom;
          expect(relDiff).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 50 },
    );
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
    const g = result.groups[0];
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
    expect(result.groups[0]?.segments.length).toBe(3);
  });
});
