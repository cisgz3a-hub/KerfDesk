import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Layer, type SceneObject } from '../scene';
import { compileJob } from './compile-job';
import type { CutGroup, Job } from './job';

function firstCutGroup(job: Job): CutGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'cut') return undefined;
  return g;
}

describe('compileJob automatic tabs / bridges', () => {
  it('applies automatic tabs to closed line-mode contours after machine transforms', () => {
    const layer: Layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      tabsEnabled: true,
      tabSizeMm: 2,
      tabsPerShape: 4,
    };
    const square = svgObj({
      id: 'O1',
      color: '#ff0000',
      closed: true,
      points: squarePoints(10, 10, 10),
    });

    const group = firstCutGroup(
      compileJob({ objects: [square], layers: [layer] }, DEFAULT_DEVICE_PROFILE),
    );

    expect(group?.segments).toHaveLength(4);
    expect(group?.segments.every((segment) => segment.closed === false)).toBe(true);
    expect(group?.segments[0]?.polyline).toEqual([
      { x: 16, y: 390 },
      { x: 20, y: 390 },
      { x: 20, y: 386 },
    ]);
  });

  it('keeps same-color inner closed contours whole when tabSkipInnerShapes is enabled', () => {
    const layer: Layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      tabsEnabled: true,
      tabSizeMm: 2,
      tabsPerShape: 4,
      tabSkipInnerShapes: true,
    };
    const annulus: SceneObject = {
      kind: 'imported-svg',
      id: 'O1',
      source: 'annulus.svg',
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            { closed: true, points: squarePoints(10, 10, 20) },
            { closed: true, points: squarePoints(15, 15, 5) },
          ],
        },
      ],
    };

    const group = firstCutGroup(
      compileJob({ objects: [annulus], layers: [layer] }, DEFAULT_DEVICE_PROFILE),
    );

    expect(group?.segments.filter((segment) => !segment.closed)).toHaveLength(4);
    expect(group?.segments.filter((segment) => segment.closed)).toHaveLength(1);
  });
});

function svgObj(args: {
  id: string;
  color: string;
  points: ReadonlyArray<{ x: number; y: number }>;
  closed?: boolean;
}): SceneObject {
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      { color: args.color, polylines: [{ points: args.points, closed: args.closed ?? false }] },
    ],
  };
}

function squarePoints(
  x: number,
  y: number,
  size: number,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  return [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
}
