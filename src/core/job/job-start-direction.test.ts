import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import { createProject } from '../scene';
import { CUT_DIRECTIONS } from './directional-order';
import type { CutGroup, CutSegment, Job } from './job';
import { applyJobStartPoint, jobStartPointOptions, resolveJobStartPoint } from './job-start-point';
import { buildMotionManifest } from './motion-manifest';
import { optimizePaths } from './optimize-paths';

function square(at: number): CutSegment {
  return {
    closed: true,
    polyline: [
      { x: at, y: at },
      { x: at + 10, y: at },
      { x: at + 10, y: at + 10 },
      { x: at, y: at + 10 },
      { x: at, y: at },
    ],
  };
}
function group(segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId: 'cut',
    color: '#000',
    speed: 1000,
    power: 50,
    passes: 1,
    airAssist: false,
    segments,
  };
}
function firstGroup(job: Job): CutGroup {
  const first = job.groups[0];
  if (first?.kind !== 'cut') throw new Error('Expected cut group');
  return first;
}

describe('selected entry preserves directional contour order', () => {
  it.each(CUT_DIRECTIONS)('keeps %s with either inside-first setting', (cutDirection) => {
    for (const insideFirst of [false, true]) {
      const optimization = {
        ...createProject().optimization,
        travelPolicy: 'nearest-neighbor' as const,
        cutDirection,
        insideFirst,
        pathDirection: 'allow-reverse' as const,
      };
      const prepared = optimizePaths(
        { groups: [group([square(20), square(40), square(0)])] },
        optimization,
      );
      const before = firstGroup(prepared).segments;
      const target = before.at(-1)!.polyline[0]!;
      const options = jobStartPointOptions(optimization);
      const selected = applyJobStartPoint(prepared, target, options);
      const after = firstGroup(selected).segments;
      expect(after.slice(1)).toEqual(before.slice(1));
      for (let i = 1; i < before.length; i++) expect(after[i]).toBe(before[i]);
      const point = after[0]!.polyline[0]!;
      const original = before[0]!.polyline[0]!;
      expect(original.x).toBe(
        cutDirection === 'top-to-bottom' || cutDirection === 'right-to-left' ? 40 : 0,
      );
      expect(point.x).toBeGreaterThanOrEqual(original.x);
      expect(point.x).toBeLessThanOrEqual(original.x + 10);
      expect(point.y).toBeGreaterThanOrEqual(original.y);
      expect(point.y).toBeLessThanOrEqual(original.y + 10);
      expect(point).not.toEqual(target);
      expect(resolveJobStartPoint(prepared, target, options)?.point).toEqual(point);
      expect(
        buildMotionManifest(grblStrategy.emit(selected, DEFAULT_DEVICE_PROFILE), {
          machineKind: 'laser',
        }).firstProcessPoint,
      ).toEqual({ ...point, z: 0 });
      const edgePoint = { x: original.x + 5, y: original.y };
      const adjusted = applyJobStartPoint(prepared, edgePoint, options);
      expect(firstGroup(adjusted).segments[0]!.polyline[0]).toEqual(edgePoint);
      expect(firstGroup(adjusted).segments.slice(1)).toEqual(before.slice(1));
    }
  });

  it.each(['allow-reverse', 'preserve'] as const)(
    'honours %s endpoints within the first open contour',
    (pathDirection) => {
      const optimization = {
        ...createProject().optimization,
        travelPolicy: 'nearest-neighbor' as const,
        cutDirection: 'left-to-right' as const,
        insideFirst: false,
        pathDirection,
      };
      const prepared = optimizePaths(
        {
          groups: [
            group([
              {
                closed: false,
                polyline: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                ],
              },
              {
                closed: false,
                polyline: [
                  { x: 20, y: 0 },
                  { x: 30, y: 0 },
                ],
              },
            ]),
          ],
        },
        optimization,
      );
      const selected = applyJobStartPoint(
        prepared,
        { x: 30, y: 0 },
        jobStartPointOptions(optimization),
      );
      expect(firstGroup(selected).segments[0]!.polyline[0]).toEqual({
        x: pathDirection === 'allow-reverse' ? 10 : 0,
        y: 0,
      });
      expect(firstGroup(selected).segments[1]).toBe(firstGroup(prepared).segments[1]);
    },
  );

  it('keeps the planner precedence when Line start region overrides directional order', () => {
    const optimization = {
      ...createProject().optimization,
      travelPolicy: 'nearest-neighbor' as const,
      cutDirection: 'left-to-right' as const,
      lineStartRegion: 'front-left' as const,
      insideFirst: false,
      pathDirection: 'allow-reverse' as const,
    };
    const prepared = optimizePaths({ groups: [group([square(0), square(40)])] }, optimization);
    const target = firstGroup(prepared).segments.at(-1)!.polyline[0]!;
    const selected = applyJobStartPoint(prepared, target, jobStartPointOptions(optimization));
    expect(firstGroup(selected).segments[0]!.polyline[0]).toEqual(target);
  });
});
