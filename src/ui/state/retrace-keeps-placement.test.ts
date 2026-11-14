// T24-P1-1 / T24R-P1-1 (tools audit T1): Re-trace Original replaces the
// selected trace in place, so a trace the operator moved, scaled, rotated or
// mirrored, or a copy placed on another blank, must stay where it was put.
// Before the fix both the vector and the Raster scan paths snapped the new
// trace back over the source photo (ADR-408 Amendment).
import { describe, expect, it } from 'vitest';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
  type SceneObject,
  type TracedImage,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';
import { applyTraceToExisting } from './scene-mutations';
import { positionTraceOverRasterSource } from './trace-placement';

const PHOTO_T: Transform = { ...IDENTITY_TRANSFORM, x: 20, y: 20 };

function photo(transform: Transform = PHOTO_T): RasterImage {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'art.png',
    dataUrl: 'data:image/png;base64,AAAA',
    pixelWidth: 400,
    pixelHeight: 300,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform,
    color: '#808080',
    operationIds: ['op-photo'],
    dither: 'threshold',
    linesPerMm: 10,
  };
}

// A 20 x 10 mm rectangle in the photo's 400 x 300 px grid, or the same
// rectangle in a grid `grid` times coarser (a capped trace working grid).
function traceGeometry(id: string, grid = 1): TracedImage {
  const p = (x: number, y: number): Vec2 => ({ x: x / grid, y: y / grid });
  return {
    kind: 'traced-image',
    id,
    source: 'art.png',
    traceSourceId: 'photo',
    traceMode: 'filled-contours',
    tracePixelWidth: 400 / grid,
    tracePixelHeight: 300 / grid,
    bounds: { minX: 100 / grid, minY: 100 / grid, maxX: 300 / grid, maxY: 200 / grid },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [{ closed: true, points: [p(100, 100), p(300, 100), p(300, 200), p(100, 200)] }],
      },
    ],
  };
}

const photoLayer = (): Layer => ({
  ...createLayer({ id: 'op-photo', name: 'photo', color: '#808080', mode: 'image' }),
  output: false,
});
const artLayer = (): Layer => ({
  ...createLayer({ id: 'op-art', name: 'art', color: '#2563eb', mode: 'fill' }),
  power: 80,
  speed: 600,
  passes: 2,
});

function project(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, objects: [...objects], layers: [...layers] } };
}

function placed(id: string, tweak: (t: Transform) => Transform): TracedImage {
  const registered = positionTraceOverRasterSource(photo(), traceGeometry(id));
  return { ...registered, transform: tweak(registered.transform), operationIds: ['op-art'] };
}

// What the Trace dialog hands the store: same id, identity transform.
function retrace(before: Project, id: string, grid = 1): Project {
  return applyTraceToExisting(
    { project: before, undoStack: [] },
    'photo',
    traceGeometry(id, grid),
    {
      replaceTraceId: id,
    },
  ).project;
}

function object<T extends SceneObject>(p: Project, id: string): T {
  const found = p.scene.objects.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found as T;
}

// The trace's rectangle corners in scene millimetres.
function corners(trace: TracedImage): ReadonlyArray<Vec2> {
  const points = trace.paths[0]?.polylines[0]?.points ?? [];
  return points.map((point) => applyTransform(point, trace.transform));
}

function expectSamePlace(after: ReadonlyArray<Vec2>, before: ReadonlyArray<Vec2>): void {
  expect(after).toHaveLength(before.length);
  after.forEach((point, index) => {
    expect(point.x).toBeCloseTo(before[index]!.x, 6);
    expect(point.y).toBeCloseTo(before[index]!.y, 6);
  });
}

describe('Re-trace Original keeps a vector trace where the operator put it (T24-P1-1)', () => {
  const tweaks: ReadonlyArray<[string, (t: Transform) => Transform]> = [
    ['a 3 mm nudge', (t) => ({ ...t, x: t.x + 3, y: t.y - 2 })],
    ['a 95 % scale', (t) => ({ ...t, scaleX: t.scaleX * 0.95, scaleY: t.scaleY * 0.95 })],
    ['a move plus a 90 degree turn', (t) => ({ ...t, x: 200, y: 150, rotationDeg: 90 })],
    [
      'a mirrored, turned and halved trace',
      (t) => ({
        ...t,
        x: 220,
        y: 160,
        rotationDeg: 30,
        scaleX: t.scaleX * 0.5,
        scaleY: t.scaleY * 0.5,
        mirrorX: true,
      }),
    ],
  ];

  for (const [label, tweak] of tweaks) {
    it(`keeps ${label}`, () => {
      const trace = placed('trace', tweak);
      const before = project([photo(), trace], [photoLayer(), artLayer()]);
      const after = retrace(before, 'trace');
      expectSamePlace(corners(object(after, 'trace')), corners(trace));
    });
  }

  it('keeps the place when the new trace runs on a coarser working grid', () => {
    const trace = placed('trace', (t) => ({ ...t, x: 200, y: 150, rotationDeg: 90 }));
    const before = project([photo(), trace], [photoLayer(), artLayer()]);
    const after = retrace(before, 'trace', 2);
    expectSamePlace(corners(object(after, 'trace')), corners(trace));
  });

  it('leaves an unmoved trace registered over its photo', () => {
    const trace = placed('trace', (t) => t);
    const before = project([photo(), trace], [photoLayer(), artLayer()]);
    const after = retrace(before, 'trace', 2);
    const registered = positionTraceOverRasterSource(photo(), traceGeometry('trace', 2));
    expect(object<TracedImage>(after, 'trace').transform).toEqual(registered.transform);
  });

  it('takes a nudged trace along when its photo moves while the dialog is open', () => {
    const trace = placed('trace', (t) => ({ ...t, x: t.x + 3 }));
    const movedPhoto = photo({ ...PHOTO_T, x: 120, y: 70 });
    const before = project([movedPhoto, trace], [photoLayer(), artLayer()]);
    const after = applyTraceToExisting(
      { project: before, undoStack: [] },
      'photo',
      traceGeometry('trace'),
      { replaceTraceId: 'trace', retraceSourceTransform: PHOTO_T },
    ).project;
    expectSamePlace(
      corners(object(after, 'trace')),
      corners(trace).map((point) => ({ x: point.x + 100, y: point.y + 50 })),
    );
  });

  it('re-traces a copy moved onto a second blank without moving it onto the original', () => {
    const original = placed('orig', (t) => t);
    const copy = placed('copy', (t) => ({ ...t, x: t.x + 100 }));
    const before = project([photo(), original, copy], [photoLayer(), artLayer()]);
    const after = retrace(before, 'copy');
    expect(object(after, 'orig')).toBe(original);
    expectSamePlace(corners(object(after, 'copy')), corners(copy));
  });

  it('keeps a moved Raster scan result when it is re-traced as vectors', () => {
    const result: RasterImage = {
      ...photo(),
      id: 'result',
      source: 'art.png (trace)',
      traceSourceId: 'photo',
      bounds: { minX: 20, minY: 20, maxX: 60, maxY: 50 },
      transform: { ...IDENTITY_TRANSFORM, x: 180, y: 130, rotationDeg: 90 },
      operationIds: ['op-result'],
    };
    const resultLayer = createLayer({
      id: 'op-result',
      name: 'r',
      color: '#16a34a',
      mode: 'image',
    });
    const before = project([photo(), result], [photoLayer(), resultLayer]);
    const after = retrace(before, 'result');
    // The vector lands where the operator's offset puts the over-photo trace.
    const overPhoto = corners(positionTraceOverRasterSource(photo(), traceGeometry('result')));
    expectSamePlace(
      corners(object(after, 'result')),
      overPhoto.map((point) => applyTransform(point, result.transform)),
    );
  });
});

describe('Re-trace Original keeps a moved Raster scan result in place (T24R-P1-1)', () => {
  const resultLayer = (): Layer => ({
    ...createLayer({ id: 'op-result', name: 'result', color: '#16a34a', mode: 'image' }),
    power: 70,
    speed: 900,
  });

  function bitmap(transform: Transform): RasterImage {
    return {
      ...photo(),
      id: 'result',
      source: 'art.png (trace)',
      traceSourceId: 'photo',
      pixelWidth: 40,
      pixelHeight: 30,
      linesPerMm: 1,
      bounds: { minX: 20, minY: 20, maxX: 60, maxY: 50 },
      transform,
      operationIds: ['op-result'],
      powerScale: 40,
    };
  }

  function rasterRetrace(before: Project): RasterImage {
    // trace-raster-output bakes the bitmap over the source: identity transform.
    const { operationIds: _ids, powerScale: _scale, ...incoming } = bitmap(IDENTITY_TRANSFORM);
    const after = applyRasterizedTraceToExisting(
      { project: before, undoStack: [] },
      'photo',
      incoming as RasterImage,
      { replaceTraceId: 'result' },
    ).project;
    return object<RasterImage>(after, 'result');
  }

  for (const transform of [
    { ...IDENTITY_TRANSFORM, x: 180, y: 130 },
    { ...IDENTITY_TRANSFORM, x: 300, y: 10, rotationDeg: 90, mirrorY: true, scaleX: 0.9 },
  ]) {
    it(`keeps a result moved to ${JSON.stringify(transform)}`, () => {
      const before = project([photo(), bitmap(transform)], [photoLayer(), resultLayer()]);
      const after = rasterRetrace(before);
      expect(after.transform).toEqual(transform);
      expect(after.operationIds).toEqual(['op-result']);
      expect(after.powerScale).toBe(40);
    });
  }

  it('keeps a moved vector trace when it is re-traced as a Raster scan', () => {
    const trace = placed('result', (t) => ({ ...t, x: t.x + 100, y: t.y + 50 }));
    const before = project([photo(), trace], [photoLayer(), artLayer()]);
    const { operationIds: _ids, powerScale: _scale, ...incoming } = bitmap(IDENTITY_TRANSFORM);
    const after = applyRasterizedTraceToExisting(
      { project: before, undoStack: [] },
      'photo',
      incoming as RasterImage,
      { replaceTraceId: 'result' },
    ).project;
    const placedResult = object<RasterImage>(after, 'result');
    // The bitmap's corner (20, 20) over the photo moves by the operator's offset.
    const corner = applyTransform({ x: 20, y: 20 }, placedResult.transform);
    expect(corner.x).toBeCloseTo(120, 6);
    expect(corner.y).toBeCloseTo(70, 6);
  });
});
