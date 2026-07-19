import { describe, expect, it, vi } from 'vitest';
import type * as LumaBitmapModule from '../raster/luma-bitmap';

vi.mock('../raster/luma-bitmap', async (importOriginal) => {
  const actual = await importOriginal<typeof LumaBitmapModule>();
  return {
    ...actual,
    lumaToBitmap: vi.fn(async (raster) => ({
      dataUrl: 'data:image/png;base64,',
      lumaBase64: actual.lumaToBase64(raster.luma),
    })),
  };
});

import { compileJob } from '../../core/job';
import {
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Bounds,
  type Layer,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode/emit-gcode';
import { applyRasterizedTraceToExisting } from '../state/rasterized-trace-mutation';
import { buildRasterTraceOutput } from './trace-raster-output';

function imageOperation(): Layer {
  return {
    ...createLayer({ id: 'image-op', color: '#808080', mode: 'image' }),
    power: 60,
    speed: 1000,
    ditherAlgorithm: 'threshold',
    linesPerMm: 10,
  };
}

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source-photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,',
    pixelWidth: 200,
    pixelHeight: 200,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
    color: '#808080',
    operationIds: ['image-op'],
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function oneDimensionalTrace(
  traceMode: 'centerline' | 'edge',
  bounds: Bounds,
  points: ReadonlyArray<{ readonly x: number; readonly y: number }>,
): TracedImage {
  return {
    kind: 'traced-image',
    id: `${traceMode}-raster`,
    source: 'photo.png',
    traceSourceId: 'source-photo',
    traceMode,
    tracePixelWidth: 200,
    tracePixelHeight: 200,
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#000000', polylines: [{ closed: false, points }] }],
  };
}

const CASES = [
  {
    label: 'horizontal Centerline',
    trace: oneDimensionalTrace('centerline', { minX: 20, minY: 100, maxX: 180, maxY: 100 }, [
      { x: 20, y: 100 },
      { x: 180, y: 100 },
    ]),
  },
  {
    label: 'vertical Edge',
    trace: oneDimensionalTrace('edge', { minX: 100, minY: 20, maxX: 100, maxY: 180 }, [
      { x: 100, y: 20 },
      { x: 100, y: 180 },
    ]),
  },
] as const;

describe('one-dimensional raster trace output', () => {
  it.each(CASES)('builds, compiles, and emits a $label trace', async ({ trace }) => {
    const source = sourceRaster();
    const operation = imageOperation();
    const raster = await buildRasterTraceOutput(source, trace, [operation]);
    const base = createProject();
    const project = {
      ...base,
      scene: { ...base.scene, objects: [source], layers: [operation] },
    };
    const committed = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      source.id,
      raster,
      { deleteSourceAfterTrace: true },
    ).project;

    expect(raster.bounds.maxX - raster.bounds.minX).toBeGreaterThan(0);
    expect(raster.bounds.maxY - raster.bounds.minY).toBeGreaterThan(0);
    expect(raster.pixelWidth).toBeGreaterThan(0);
    expect(raster.pixelHeight).toBeGreaterThan(0);

    const group = compileJob(committed.scene, committed.device).groups[0];
    expect(group).toMatchObject({ kind: 'raster', sourceObjectId: trace.id });
    if (group?.kind !== 'raster') throw new Error('missing compiled raster group');
    expect([...group.sValues].some((value) => value > 0)).toBe(true);

    const emitted = emitGcode(committed);
    expect(emitted.preflight.issues).toEqual([]);
    expect(emitted.gcode).toMatch(/S[1-9][0-9]*/);
  });
});
