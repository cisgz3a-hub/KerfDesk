import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION, type Vec2 } from '../scene';
import type { LineStartRegion } from '../scene/project';
import type { CncGroup, CutGroup, CutSegment, FillGroup, Job, RasterGroup } from './job';
import { optimizePaths } from './optimize-paths';

function closed(points: ReadonlyArray<Vec2>): CutSegment {
  return { closed: true, polyline: [...points, points[0] as Vec2] };
}

function rectangle(x: number, y: number, size: number): CutSegment {
  return closed([
    { x: x + size, y: y + size },
    { x, y: y + size },
    { x, y },
    { x: x + size, y },
  ]);
}

function group(segments: ReadonlyArray<CutSegment>, extra: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'line',
    color: '#000',
    power: 30,
    speed: 1000,
    passes: 2,
    airAssist: false,
    segments,
    ...extra,
  };
}

function first(job: Job): Vec2 | undefined {
  const line = job.groups.find((candidate) => candidate.kind === 'cut');
  return line?.kind === 'cut' ? line.segments[0]?.polyline[0] : undefined;
}

const BORDER_POINTS: ReadonlyArray<Vec2> = [
  { x: 20, y: 10 },
  { x: 30, y: 10 },
  { x: 30, y: 20 },
  { x: 30, y: 30 },
  { x: 20, y: 30 },
  { x: 10, y: 30 },
  { x: 10, y: 20 },
  { x: 10, y: 10 },
];
const REGION_ENTRIES: ReadonlyArray<readonly [LineStartRegion, Vec2]> = [
  ['back-left', { x: 10, y: 30 }],
  ['back-center', { x: 20, y: 30 }],
  ['back-right', { x: 30, y: 30 }],
  ['center-left', { x: 10, y: 20 }],
  ['center', { x: 20, y: 20 }],
  ['center-right', { x: 30, y: 20 }],
  ['front-left', { x: 10, y: 10 }],
  ['front-center', { x: 20, y: 10 }],
  ['front-right', { x: 30, y: 10 }],
];

describe('opt-in physical Line burn start region', () => {
  it.each(REGION_ENTRIES)(
    'activates %s under source order and drawn starts',
    (lineStartRegion, expected) => {
      const border = closed(BORDER_POINTS);
      const middle: CutSegment = {
        closed: false,
        polyline: [
          { x: 20, y: 20 },
          { x: 22, y: 20 },
        ],
      };
      const job: Job = { groups: [group([border, middle])] };
      const result = optimizePaths(job, {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy: 'source-order',
        closedShapeStart: 'drawn',
        insideFirst: false,
        pathDirection: 'preserve',
        lineStartRegion,
      });
      expect(first(result)).toEqual(expected);
      expect(job.groups[0]).toEqual(group([border, middle]));
      const output = result.groups[0] as CutGroup;
      expect(output).toMatchObject({ power: 30, speed: 1000, passes: 2, airAssist: false });
      expect(output.segments.map((segment) => segment.polyline.length).sort()).toEqual([2, 9]);
    },
  );

  it('chooses an existing contour entry when the literal centre is empty', () => {
    const border = closed(BORDER_POINTS);
    const job: Job = { groups: [group([border])] };
    const result = optimizePaths(job, {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      lineStartRegion: 'center',
    });
    expect(first(result)).toEqual({ x: 20, y: 10 });
    expect((result.groups[0] as CutGroup).segments[0]?.polyline).toEqual(border.polyline);
    expect(first(result)).not.toEqual({ x: 20, y: 20 });
  });

  it('does not let a repeated point move the artwork region away from actual contours', () => {
    const dot: CutSegment = {
      closed: false,
      polyline: [
        { x: 1000, y: 1000 },
        { x: 1000, y: 1000 },
      ],
    };
    const result = optimizePaths(
      { groups: [group([dot, closed(BORDER_POINTS)])] },
      {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy: 'source-order',
        insideFirst: false,
        lineStartRegion: 'center',
      },
    );
    expect(first(result)).toEqual({ x: 20, y: 10 });
  });

  it('keeps inside-first safety and layer priority ahead of region distance', () => {
    const outer = rectangle(0, 0, 20);
    const inner = rectangle(5, 5, 10);
    const nearLayer = group([rectangle(0, 0, 2)], { layerId: 'near' });
    const nestedLayer = group([outer, inner], { layerId: 'nested' });
    const result = optimizePaths(
      { groups: [nearLayer, nestedLayer] },
      {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy: 'source-order',
        lineStartRegion: 'front-left',
        layerPriority: 'reverse-project-order',
        insideFirst: true,
      },
    );
    expect(result.groups.map((candidate) => candidate.layerId)).toEqual(['nested', 'near']);
    expect(first(result)).toEqual({ x: 5, y: 5 });
    const nested = result.groups[0] as CutGroup;
    expect(nested.segments[0]?.polyline).toHaveLength(inner.polyline.length);
    expect(nested.segments[1]?.polyline.some((point) => point.x === 0)).toBe(true);
  });

  it('preserves open direction restrictions and keeps a nearest-corner choice', () => {
    const backwards: CutSegment = {
      closed: false,
      polyline: [
        { x: 30, y: 10 },
        { x: 10, y: 10 },
      ],
    };
    const settings = {
      ...DEFAULT_PROJECT_OPTIMIZATION,
      travelPolicy: 'source-order' as const,
      lineStartRegion: 'front-left' as const,
      insideFirst: false,
    };
    const job: Job = { groups: [group([backwards])] };
    expect(first(optimizePaths(job, { ...settings, pathDirection: 'preserve' }))).toEqual({
      x: 30,
      y: 10,
    });
    expect(first(optimizePaths(job, { ...settings, pathDirection: 'allow-reverse' }))).toEqual({
      x: 10,
      y: 10,
    });
    const borderJob: Job = { groups: [group([closed(BORDER_POINTS)])] };
    expect(
      first(
        optimizePaths(borderJob, {
          ...settings,
          lineStartRegion: 'front-center',
          closedShapeStart: 'nearest-corner',
        }),
      ),
    ).toEqual({ x: 30, y: 10 });
  });

  it.each(['nearest-neighbor', 'source-order'] as const)(
    'keeps all non-Line plans unchanged with %s',
    (travelPolicy) => {
      const line = group([closed(BORDER_POINTS)]);
      const fill: FillGroup = {
        ...group([rectangle(60, 60, 10)]),
        kind: 'fill',
        layerId: 'fill',
        fillStyle: 'offset',
        overscanMm: 0,
        segments: [{ ...rectangle(60, 60, 10), reverse: false }],
      };
      const island: FillGroup = {
        ...fill,
        fillStyle: 'island',
        segments: [
          {
            closed: false,
            reverse: false,
            polyline: [
              { x: 80, y: 80 },
              { x: 90, y: 80 },
            ],
          },
        ],
      };
      const raster: RasterGroup = {
        kind: 'raster',
        layerId: 'image',
        color: '#000',
        power: 50,
        speed: 1000,
        passes: 1,
        airAssist: false,
        pixelWidth: 2,
        pixelHeight: 1,
        sValues: new Uint16Array([500, 500]),
        bounds: { minX: 100, minY: 100, maxX: 102, maxY: 101 },
        overscanMm: 0,
        dotWidthCorrectionMm: 0,
      };
      const cnc: CncGroup = {
        kind: 'cnc',
        layerId: 'cnc',
        color: '#000',
        cutType: 'profile-outside',
        toolDiameterMm: 3.175,
        feedMmPerMin: 1000,
        plungeMmPerMin: 300,
        spindleRpm: 12000,
        spindleSpinupSec: 0,
        safeZMm: 3.81,
        passes: [],
      };
      const job: Job = { groups: [line, fill, island, raster, cnc] };
      const settings = {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy,
        startPoint: 'job-center' as const,
        closedShapeStart: 'nearest-corner' as const,
      };
      const legacy = optimizePaths(job, settings);
      const preferred = optimizePaths(job, { ...settings, lineStartRegion: 'back-left' });
      expect(preferred.groups.slice(1)).toEqual(legacy.groups.slice(1));
      expect(preferred.groups[3]).toBe(raster);
      expect(preferred.groups[4]).toBe(cnc);
      expect(
        optimizePaths(
          { groups: [fill, island, raster, cnc] },
          { ...settings, lineStartRegion: 'center' },
        ),
      ).toEqual(optimizePaths({ groups: [fill, island, raster, cnc] }, settings));
    },
  );

  it('ignores zero-power or zero-pass contours when finding the burn region', () => {
    const dark = group([rectangle(-1000, -1000, 100)], { power: 0 });
    const skipped = group([rectangle(1000, 1000, 100)], { passes: 0 });
    const line = group([closed(BORDER_POINTS)]);
    const result = optimizePaths(
      { groups: [dark, skipped, line] },
      {
        ...DEFAULT_PROJECT_OPTIMIZATION,
        travelPolicy: 'source-order',
        lineStartRegion: 'back-right',
      },
    );
    expect(result.groups[0]).toBe(dark);
    expect(result.groups[1]).toBe(skipped);
    expect((result.groups[2] as CutGroup).segments[0]?.polyline[0]).toEqual({ x: 30, y: 30 });
  });
});
