import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../scene';
import type { CutGroup, CutSegment, Job } from './job';
import { optimizePaths } from './optimize-paths';

describe('optimizePaths source-order precedence', () => {
  it('bypasses inside-first, path direction, and planning start', () => {
    const outer = closedSegment(0, 0, 10, 10);
    const backwards = segment(100, 0, 90, 0);
    const inner = closedSegment(4, 4, 6, 6);
    const job: Job = { groups: [group('L1', [outer, backwards, inner])] };
    for (const bypassed of [
      {
        insideFirst: true,
        pathDirection: 'allow-reverse' as const,
        startPoint: 'machine-origin' as const,
      },
      {
        insideFirst: false,
        pathDirection: 'preserve' as const,
        startPoint: 'job-center' as const,
      },
    ]) {
      const result = optimizePaths(job, {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy: 'source-order',
        ...bypassed,
      });
      expect((result.groups[0] as CutGroup).segments).toEqual([outer, backwards, inner]);
    }
  });

  it('applies layer priority independently while preserving order inside operations', () => {
    const first = group('L1', [segment(100, 0, 101, 0), segment(0, 0, 1, 0)]);
    const second = group('L2', [segment(300, 0, 301, 0), segment(200, 0, 201, 0)]);
    const result = optimizePaths(
      { groups: [first, second] },
      {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy: 'source-order',
        layerPriority: 'reverse-project-order',
      },
    );

    expect(result.groups.map((candidate) => candidate.layerId)).toEqual(['L2', 'L1']);
    expect((result.groups[0] as CutGroup).segments).toEqual(second.segments);
    expect((result.groups[1] as CutGroup).segments).toEqual(first.segments);
  });
});

function segment(x1: number, y1: number, x2: number, y2: number): CutSegment {
  return {
    closed: false,
    polyline: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
  };
}

function closedSegment(minX: number, minY: number, maxX: number, maxY: number): CutSegment {
  return {
    closed: true,
    polyline: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY },
    ],
  };
}

function group(layerId: string, segments: ReadonlyArray<CutSegment>): CutGroup {
  return {
    kind: 'cut',
    layerId,
    color: '#000000',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments,
  };
}
