import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import type { CutGroup, FillGroup, Job } from './job';

// Narrow helper — every test in this file expects compileJob to
// emit CutGroups (no image-mode layers in fixtures), so the cast
// captures that invariant without sprinkling `as` everywhere.
function firstCutGroup(job: Job): CutGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'cut') return undefined;
  return g;
}

function firstFillGroup(job: Job): FillGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'fill') return undefined;
  return g;
}

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

function rasterObject(color: string): RasterImage {
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'one-pixel.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 10,
    lumaBase64: 'AA==',
  };
}

const dev = DEFAULT_DEVICE_PROFILE;

describe('compileJob', () => {
  it('returns an empty job for an empty scene', () => {
    expect(compileJob(EMPTY_SCENE, dev).groups).toEqual([]);
  });

  it('skips layers with output=false', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), output: false };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    const scene = { objects: [obj], layers: [layer] };
    expect(compileJob(scene, dev).groups).toEqual([]);
  });

  it('emits one CutGroup per matching layer in scene.layers order', () => {
    const layers = [
      createLayer({ id: 'L1', color: '#ff0000' }),
      createLayer({ id: 'L2', color: '#0000ff' }),
    ];
    const objects: SceneObject[] = [
      svgObj({
        id: 'O1',
        color: '#ff0000',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      }),
      svgObj({
        id: 'O2',
        color: '#0000ff',
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 10 },
        ],
      }),
    ];
    const job = compileJob({ objects, layers }, dev);
    expect(job.groups.map((g) => g.layerId)).toEqual(['L1', 'L2']);
  });

  it('caps speed at device.maxFeed (WORKFLOW.md F-A7 defense-in-depth)', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), speed: 99999 };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    const first = job.groups[0];
    expect(first?.kind === 'cnc' ? undefined : first?.speed).toBe(dev.maxFeed);
  });

  it('carries air assist intent onto line groups', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), airAssist: true };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ],
    });

    const job = compileJob({ objects: [obj], layers: [layer] }, dev);

    expect(job.groups[0]).toMatchObject({ kind: 'cut', airAssist: true });
  });

  it('clamps power to [0,100] and passes to ≥1', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      power: 999,
      passes: 0,
    };
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    });
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    expect(firstCutGroup(job)?.power).toBe(100);
    expect(firstCutGroup(job)?.passes).toBe(1);
  });

  it('omits a layer whose color has no matching geometry', () => {
    const layer = createLayer({ id: 'L1', color: '#00ff00' });
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000', // mismatched
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    expect(compileJob({ objects: [obj], layers: [layer] }, dev).groups).toEqual([]);
  });

  it('applies the object transform to each point, then Y-flips for front-left', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const obj: SceneObject = {
      ...svgObj({
        id: 'O1',
        color: '#ff0000',
        points: [
          { x: 1, y: 1 },
          { x: 2, y: 2 },
        ],
      }),
      transform: { ...IDENTITY_TRANSFORM, x: 100, y: 100 },
    };
    const job = compileJob({ objects: [obj], layers: [layer] }, dev);
    // Object transform: (1,1) → (101,101), (2,2) → (102,102).
    // Default device is front-left origin (bedH = 400); Y is flipped to
    // bedH - y → (101, 299), (102, 298).
    expect(firstCutGroup(job)?.segments[0]?.polyline).toEqual([
      { x: 101, y: 299 },
      { x: 102, y: 298 },
    ]);
  });

  // F.1 — fill-mode dispatch.
  it('layer.mode=fill replaces the outline with hatch lines from fillHatching', () => {
    // A closed 10×10 square with mode='fill' + hatchSpacingMm=1.0 should
    // emit hatch lines (one per scanline), not the outline's 5 corner
    // points. We don't snapshot the exact coords (those depend on the
    // half-open scanline rule + origin flip); we just assert:
    //  - more than one segment (hatching produced multiple lines)
    //  - every segment has exactly 2 points (open hatch lines, not the
    //    original 5-point closed outline)
    const layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      mode: 'fill' as const,
      hatchSpacingMm: 1.0,
      hatchAngleDeg: 0,
    };
    const sq: SceneObject = {
      kind: 'imported-svg',
      id: 'O1',
      source: 'sq.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
              ],
            },
          ],
        },
      ],
    };
    const job = compileJob({ objects: [sq], layers: [layer] }, dev);
    const fill = firstFillGroup(job);
    expect(fill?.kind).toBe('fill');
    expect(fill?.overscanMm).toBe(5);
    const segs = fill?.segments ?? [];
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs) {
      expect(seg.polyline).toHaveLength(2);
      // Hatch lines emitted by fill mode are not "closed" — they're
      // open horizontal slices, not loops.
      expect(seg.closed).toBe(false);
    }
  });

  it('layer.mode=fill on an open polyline emits nothing (no enclosed area)', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      mode: 'fill' as const,
    };
    const open = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    });
    // svgObj() returns closed: false. Fill ignores → group dropped
    // entirely (empty segments → no group emitted).
    expect(compileJob({ objects: [open], layers: [layer] }, dev).groups).toEqual([]);
  });

  it('carries air assist intent onto fill groups', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      mode: 'fill' as const,
      airAssist: true,
      hatchSpacingMm: 1,
    };
    const square: SceneObject = {
      kind: 'imported-svg',
      id: 'O1',
      source: 'sq.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [
            {
              closed: true,
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
              ],
            },
          ],
        },
      ],
    };

    const job = compileJob({ objects: [square], layers: [layer] }, dev);

    expect(job.groups[0]).toMatchObject({ kind: 'fill', airAssist: true });
  });

  it('carries air assist intent onto raster groups', () => {
    const layer = {
      ...createLayer({ id: 'L1', color: '#808080', mode: 'image' }),
      airAssist: true,
    };

    const job = compileJob({ objects: [rasterObject('#808080')], layers: [layer] }, dev);

    expect(job.groups[0]).toMatchObject({ kind: 'raster', airAssist: true });
  });

  it('applies the device origin transform on top of the object transform', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const obj = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    });
    const job = compileJob({ objects: [obj], layers: [layer] }, { ...dev, origin: 'front-right' });
    // Front-right origin → X mirrored within bed (400), Y flipped (SVG top
    // y=0 → machine back y=bedHeight).
    expect(firstCutGroup(job)?.segments[0]?.polyline).toEqual([
      { x: 400, y: 400 },
      { x: 390, y: 400 },
    ]);
  });

  it('applies line-mode kerf offset to closed contours without mutating scene geometry', () => {
    const layer: Layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      kerfOffsetMm: 1,
    };
    const square = svgObj({
      id: 'O1',
      color: '#ff0000',
      closed: true,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 },
      ],
    });
    const before = JSON.stringify(square);

    const job = compileJob({ objects: [square], layers: [layer] }, dev);

    expect(JSON.stringify(square)).toBe(before);
    expect(cutBounds(firstCutGroup(job))).toEqual({ minX: 9, minY: 379, maxX: 21, maxY: 391 });
  });

  it('does not apply kerf offset to open line-mode paths', () => {
    const layer: Layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      kerfOffsetMm: 1,
    };
    const open = svgObj({
      id: 'O1',
      color: '#ff0000',
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
      ],
    });

    const job = compileJob({ objects: [open], layers: [layer] }, dev);

    expect(firstCutGroup(job)?.segments[0]?.polyline).toEqual([
      { x: 10, y: 390 },
      { x: 20, y: 390 },
    ]);
  });

  it('shrinks inner closed contours when positive kerf offsets a same-color hole', () => {
    const layer: Layer = {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      kerfOffsetMm: 1,
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
            {
              closed: true,
              points: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
                { x: 20, y: 20 },
                { x: 10, y: 20 },
              ],
            },
            {
              closed: true,
              points: [
                { x: 13, y: 13 },
                { x: 17, y: 13 },
                { x: 17, y: 17 },
                { x: 13, y: 17 },
              ],
            },
          ],
        },
      ],
    };

    const group = firstCutGroup(compileJob({ objects: [annulus], layers: [layer] }, dev));
    const boxes = (group?.segments ?? []).map((segment) => segmentBounds(segment.polyline));

    expect(boxes).toContainEqual({ minX: 9, minY: 379, maxX: 21, maxY: 391 });
    expect(boxes).toContainEqual({ minX: 14, minY: 384, maxX: 16, maxY: 386 });
  });
});

function cutBounds(group: CutGroup | undefined): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  if (group === undefined) throw new Error('expected cut group');
  const points = group.segments.flatMap((segment) => segment.polyline);
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

function segmentBounds(polyline: ReadonlyArray<{ readonly x: number; readonly y: number }>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  return {
    minX: Math.min(...polyline.map((point) => point.x)),
    minY: Math.min(...polyline.map((point) => point.y)),
    maxX: Math.max(...polyline.map((point) => point.x)),
    maxY: Math.max(...polyline.map((point) => point.y)),
  };
}
