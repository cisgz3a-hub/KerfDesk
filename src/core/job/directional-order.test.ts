import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { directionalSegmentOrder } from './directional-order';
import type { CutSegment } from './job';

function square(x: number, y: number, size = 4): CutSegment {
  const points: Vec2[] = [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
  ];
  return { polyline: points, closed: true };
}

const line = (from: Vec2, to: Vec2): CutSegment => ({ polyline: [from, to], closed: false });

const starts = (segments: ReadonlyArray<CutSegment>) => segments.map((s) => s.polyline[0]);

describe('cut in directional order', () => {
  // Machine coordinates on a front-left origin: larger Y is the back, the workspace top.
  const low = square(0, 0);
  const mid = square(20, 50);
  const high = square(10, 100);

  it('sweeps top to bottom and bottom to top by the back/front of the bed', () => {
    const options = { origin: 'front-left' as const, insideFirst: false, allowsReverse: true };
    expect(
      directionalSegmentOrder([low, mid, high], { ...options, direction: 'top-to-bottom' }),
    ).toEqual([high, mid, low]);
    expect(
      directionalSegmentOrder([high, low, mid], { ...options, direction: 'bottom-to-top' }),
    ).toEqual([low, mid, high]);
    // A rear origin puts machine Y = 0 at the back, so "top" is small Y.
    expect(
      directionalSegmentOrder([low, mid, high], {
        ...options,
        origin: 'rear-left',
        direction: 'top-to-bottom',
      }),
    ).toEqual([low, mid, high]);
  });

  it('sweeps left to right, mirrored on right-hand origins', () => {
    const options = {
      insideFirst: false,
      allowsReverse: true,
      direction: 'left-to-right' as const,
    };
    expect(directionalSegmentOrder([mid, low, high], { ...options, origin: 'front-left' })).toEqual(
      [low, high, mid],
    );
    expect(
      directionalSegmentOrder([low, mid, high], { ...options, origin: 'front-right' }),
    ).toEqual([mid, high, low]);
  });

  it('keeps inside-first: an enclosed contour goes before the one around it', () => {
    const outer = square(0, 0, 50);
    const inner = square(10, 10, 5);
    const other = square(0, 100);
    const ordered = directionalSegmentOrder([outer, other, inner], {
      origin: 'front-left',
      insideFirst: true,
      allowsReverse: true,
      direction: 'top-to-bottom',
    });
    expect(ordered.indexOf(inner)).toBeLessThan(ordered.indexOf(outer));
  });

  it('enters open paths from the end nearer the head when reversing is allowed', () => {
    const first = line({ x: 0, y: 100 }, { x: 10, y: 100 });
    const second = line({ x: 0, y: 50 }, { x: 10, y: 50 });
    const options = {
      origin: 'front-left' as const,
      insideFirst: false,
      direction: 'top-to-bottom' as const,
    };
    expect(
      starts(directionalSegmentOrder([second, first], { ...options, allowsReverse: true })),
    ).toEqual([
      { x: 0, y: 100 },
      { x: 10, y: 50 },
    ]);
    expect(
      starts(directionalSegmentOrder([second, first], { ...options, allowsReverse: false })),
    ).toEqual([
      { x: 0, y: 100 },
      { x: 0, y: 50 },
    ]);
  });
});

describe('directional order in the planner', () => {
  it('orders a Line group by the chosen sweep when the planner runs', async () => {
    const { optimizePaths } = await import('./optimize-paths');
    const segments = [square(0, 0), square(0, 100), square(0, 50)];
    const group = {
      kind: 'cut' as const,
      layerId: 'l',
      color: '#000000',
      power: 10,
      speed: 1000,
      passes: 1,
      airAssist: false,
      segments,
    };
    const job = optimizePaths(
      { groups: [group] },
      {
        travelPolicy: 'nearest-neighbor',
        insideFirst: false,
        layerPriority: 'project-order',
        pathDirection: 'allow-reverse',
        startPoint: 'machine-origin',
        cutDirection: 'top-to-bottom',
      },
    );
    const ordered = job.groups[0]?.kind === 'cut' ? job.groups[0].segments : [];
    expect(ordered.map((segment) => segment.polyline[0]?.y)).toEqual([100, 50, 0]);
  });
});
