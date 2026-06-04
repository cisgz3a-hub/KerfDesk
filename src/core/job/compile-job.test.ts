import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type SceneObject,
} from '../scene';
import { compileJob } from './compile-job';
import type { CutGroup, FillGroup, Job, RasterGroup } from './job';

// Narrow helper — every test in this file expects compileJob to
// emit CutGroups (no image-mode layers in fixtures), so the cast
// captures that invariant without sprinkling `as` everywhere.
function firstCutGroup(job: Job): CutGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'cut') return undefined;
  return g;
}

function firstRasterGroup(job: Job): RasterGroup | undefined {
  const g = job.groups[0];
  if (g === undefined || g.kind !== 'raster') return undefined;
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
}): SceneObject {
  return {
    kind: 'imported-svg',
    id: args.id,
    source: `${args.id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: args.color, polylines: [{ points: args.points, closed: false }] }],
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
    expect(job.groups[0]?.speed).toBe(dev.maxFeed);
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
});

describe('compileJob raster image groups', () => {
  function rasterObject(lumaBase64?: string): RasterImage {
    return {
      kind: 'raster-image',
      id: 'R1',
      source: 'photo.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 },
      transform: IDENTITY_TRANSFORM,
      color: '#808080',
      dither: 'threshold',
      linesPerMm: 10,
      ...(lumaBase64 !== undefined ? { lumaBase64 } : {}),
    };
  }

  it('carries raster layer passes into the raster group', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      passes: 3,
    };
    const job = compileJob({ objects: [rasterObject('AP//AA==')], layers: [layer] }, dev);
    expect(firstRasterGroup(job)).toMatchObject({ passes: 3 });
  });

  it('maps grayscale image layers between minPower and power while keeping white off', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'grayscale' as const,
      minPower: 10,
      power: 30,
      linesPerMm: 1,
    };
    const image: SceneObject = {
      ...rasterObject('AID/'),
      pixelWidth: 3,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 1 },
    };

    const job = compileJob({ objects: [image], layers: [layer] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([300, 200, 0]);
  });

  it('resamples raster dimensions from image layer lines-per-mm', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 2,
    };
    const job = compileJob({ objects: [rasterObject('AP//AA==')], layers: [layer] }, dev);
    const raster = firstRasterGroup(job);
    expect(raster?.pixelWidth).toBe(20);
    expect(raster?.pixelHeight).toBe(10);
    expect(raster?.sValues).toHaveLength(200);
  });

  it('treats missing luma as white so legacy rasters fail safe', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 1,
    };
    const job = compileJob({ objects: [rasterObject()], layers: [layer] }, dev);
    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual(new Array(50).fill(0));
  });

  it('decodes saved luma without relying on a host atob global', () => {
    const originalAtob = globalThis.atob;
    Object.defineProperty(globalThis, 'atob', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      const layer = {
        ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
        ditherAlgorithm: 'threshold' as const,
        linesPerMm: 1,
      };
      const job = compileJob({ objects: [rasterObject('AP//AA==')], layers: [layer] }, dev);
      expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toContain(300);
    } finally {
      Object.defineProperty(globalThis, 'atob', {
        value: originalAtob,
        configurable: true,
        writable: true,
      });
    }
  });

  it('maps the source bitmap top row to the machine back on front-left devices', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 1,
    };
    const imageTopRowBlack: SceneObject = {
      ...rasterObject('AAD//w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };

    const job = compileJob({ objects: [imageTopRowBlack], layers: [layer] }, dev);

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([0, 0, 300, 300]);
  });

  it('maps the source bitmap left column to machine-right on front-right devices', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 1,
    };
    const imageLeftColumnBlack: SceneObject = {
      ...rasterObject('AP8A/w=='),
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    };

    const job = compileJob(
      { objects: [imageLeftColumnBlack], layers: [layer] },
      { ...dev, origin: 'front-right' },
    );

    expect(Array.from(firstRasterGroup(job)?.sValues ?? [])).toEqual([0, 300, 0, 300]);
  });

  it('measures transformed raster bounds from all four corners', () => {
    const layer = {
      ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
      ditherAlgorithm: 'threshold' as const,
      linesPerMm: 1,
    };
    const rotatedRaster: SceneObject = {
      ...rasterObject('AP//AA=='),
      transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 },
    };
    const job = compileJob({ objects: [rotatedRaster], layers: [layer] }, dev);
    const bounds = firstRasterGroup(job)?.bounds;
    expect(bounds?.minX).toBeCloseTo(-5 * Math.SQRT1_2);
    expect(bounds?.maxX).toBeCloseTo(10 * Math.SQRT1_2);
    expect(bounds?.minY).toBeCloseTo(dev.bedHeight - 15 * Math.SQRT1_2);
    expect(bounds?.maxY).toBeCloseTo(dev.bedHeight);
  });

  it('does not raster-engrave trace-source backing images', () => {
    const source = { ...rasterObject('AP//AA=='), role: 'trace-source' as const };
    const trace: SceneObject = {
      kind: 'traced-image',
      id: 'T1',
      source: 'photo.png',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#000000',
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
    const layers = [
      createLayer({ id: 'image', color: '#808080', mode: 'image' }),
      { ...createLayer({ id: 'trace', color: '#000000', mode: 'fill' }), hatchSpacingMm: 2 },
    ];
    const job = compileJob({ objects: [source, trace], layers }, dev);
    expect(job.groups.map((g) => g.kind)).toEqual(['fill']);
  });
});
