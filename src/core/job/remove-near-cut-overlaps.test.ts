// Remove overlapping lines with a merge tolerance (LBG-C13): near-coincident
// Line spans of later contours are cut once, crossings and T-junctions never
// merge, merges do not chain, and a tolerance of 0 keeps the exact rule.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../scene';
import type { CutGroup, CutSegment } from './job';
import { optimizePaths } from './optimize-paths';
import { removeCutOverlaps } from './remove-cut-overlaps';

const path = (...points: Array<readonly [number, number]>): CutSegment => ({
  closed: false,
  polyline: points.map(([x, y]) => ({ x, y })),
});
const square = (x: number, y = 0, size = 10): CutSegment => ({
  ...path([x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]),
  closed: true,
});
const group = (segments: CutSegment[]): CutGroup => ({
  kind: 'cut',
  layerId: 'line',
  color: '#000000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments,
});
const length = (segments: ReadonlyArray<CutSegment>): number =>
  segments.reduce(
    (sum, segment) =>
      sum +
      segment.polyline
        .slice(1)
        .reduce(
          (part, point, i) =>
            part + Math.hypot(point.x - segment.polyline[i]!.x, point.y - segment.polyline[i]!.y),
          0,
        ),
    0,
  );

describe('overlap removal with a merge tolerance', () => {
  it('cuts a near-coincident line once, only when the tolerance reaches it', () => {
    const lines = group([path([0, 0], [10, 0]), path([0, 0.03], [10, 0.03])]);
    expect(removeCutOverlaps(lines)).toBe(lines);
    expect(removeCutOverlaps(lines, 0.02)).toBe(lines);
    const merged = removeCutOverlaps(lines, 0.05);
    expect(merged.segments).toEqual([lines.segments[0]]);
  });

  it('keeps the part of a later line that runs past the earlier one, the way it was going', () => {
    const merged = removeCutOverlaps(
      group([path([0, 0], [10, 0]), path([15, 0.02], [5, 0.02])]),
      0.05,
    );
    expect(merged.segments[1]?.polyline).toEqual([
      { x: 15, y: 0.02 },
      { x: 10, y: 0.02 },
    ]);
    expect(length(merged.segments)).toBeCloseTo(15, 9);
  });

  it('merges the shared side of two squares drawn a hair apart, never bridging the gap', () => {
    const merged = removeCutOverlaps(group([square(0), square(10.02)]), 0.05);
    expect(length(merged.segments)).toBeCloseTo(70, 9);
    expect(merged.segments[0]?.closed).toBe(true);
    expect(merged.segments.slice(1).every((segment) => !segment.closed)).toBe(true);
    // The exact rule leaves both sides.
    expect(length(removeCutOverlaps(group([square(0), square(10.02)])).segments)).toBe(80);
  });

  it('never merges crossing lines or a line meeting another at a T', () => {
    const crossing = group([
      path([0, 0], [10, 0]),
      path([5, -5], [5, 5]),
      path([0, -0.4], [10, 0.4]),
      path([3, 10], [3, 0]),
    ]);
    expect(removeCutOverlaps(crossing, 0.2)).toBe(crossing);
  });

  it('merges a copy turned by a hair over its whole length, although it crosses the original', () => {
    const turned = group([path([0, 0], [10, 0]), path([0, -0.01], [10, 0.01])]);
    expect(removeCutOverlaps(turned, 0.05).segments).toEqual([turned.segments[0]]);
  });

  it('measures later lines against what is still cut, so merges do not chain', () => {
    const row = group([
      path([0, 0], [10, 0]),
      path([0, 0.04], [10, 0.04]),
      path([0, 0.08], [10, 0.08]),
    ]);
    const merged = removeCutOverlaps(row, 0.05);
    expect(merged.segments.map((segment) => segment.polyline[0]?.y)).toEqual([0, 0.08]);
  });

  it('keeps deliberate retracing inside one contour and still merges exact overlaps', () => {
    const retrace = group([path([0, 0], [10, 0], [10, 0.02], [0, 0.02])]);
    expect(removeCutOverlaps(retrace, 0.05)).toBe(retrace);
    const duplicates = removeCutOverlaps(group([square(0), square(0)]), 0.05);
    expect(duplicates.segments).toEqual([square(0)]);
  });

  it('skips CNC timing projections at any tolerance', () => {
    const cnc = group(
      [path([0, 0], [10, 0]), path([0, 0.01], [10, 0.01])].map((segment) => ({
        ...segment,
        plannerCoordinatesRepresented: true as const,
      })),
    );
    expect(removeCutOverlaps(cnc, 0.05)).toBe(cnc);
  });

  it('reaches the planner through the project setting', () => {
    const job = { groups: [group([path([0, 0], [10, 0]), path([0, 0.03], [10, 0.03])])] };
    const settings = {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      travelPolicy: 'source-order' as const,
      removeOverlappingLines: true,
    };
    const exact = optimizePaths(job, settings);
    expect(exact.groups[0]?.kind === 'cut' && exact.groups[0].segments).toHaveLength(2);
    const merged = optimizePaths(job, { ...settings, overlapMergeToleranceMm: 0.05 });
    expect(merged.groups[0]?.kind === 'cut' && merged.groups[0].segments).toHaveLength(1);
    const off = optimizePaths(job, {
      ...settings,
      removeOverlappingLines: false,
      overlapMergeToleranceMm: 0.05,
    });
    expect(off.groups[0]?.kind === 'cut' && off.groups[0].segments).toHaveLength(2);
  });
});
