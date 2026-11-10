import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type RasterImage,
  type Scene,
  type SceneObject,
} from '../scene';
import { layerOperationOutputEqual } from '../scene/layer';
import { compileJob } from './compile-job';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import type { RasterGroup } from './job';
import { rasterRow } from './raster-rows';

const DEVICE = DEFAULT_DEVICE_PROFILE;

// Five pixels from black to white: darkness 255, 191, 127, 64, 0.
function gradient(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'depth',
    source: 'depth.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AECAv/8=',
    pixelWidth: 5,
    pixelHeight: 1,
    bounds: { minX: 10, minY: 10, maxX: 15, maxY: 11 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: '3d-sliced',
    linesPerMm: 1,
  };
}

function imageLayer(settings: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'img', color: '#808080', mode: 'image' }),
    ditherAlgorithm: '3d-sliced',
    linesPerMm: 1,
    passes: 4,
    power: 50,
    ...settings,
  };
}

function scene(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Scene {
  return { ...EMPTY_SCENE, objects, layers };
}

function rasterGroups(sceneValue: Scene): RasterGroup[] {
  return compileJob(sceneValue, DEVICE).groups.filter(
    (group): group is RasterGroup => group.kind === 'raster',
  );
}

function rows(group: RasterGroup): number[] {
  return Array.from({ length: group.pixelHeight }, (_, y) =>
    Array.from(rasterRow(group, y)),
  ).flat();
}

const S_ON = Math.round(0.5 * DEVICE.maxPowerS);

describe('3D Sliced image compilation (ADR-699)', () => {
  it('burns one group per slice, each pixel on as many passes as its depth', () => {
    const groups = rasterGroups(scene([gradient()], [imageLayer()]));
    expect(groups).toHaveLength(4);
    expect(groups.map((group) => group.passes)).toEqual([1, 1, 1, 1]);
    const passes = groups.map(rows);
    expect(passes).toEqual([
      [S_ON, 0, 0, 0, 0],
      [S_ON, S_ON, 0, 0, 0],
      [S_ON, S_ON, S_ON, 0, 0],
      [S_ON, S_ON, S_ON, S_ON, 0],
    ]);
  });

  it('scans each slice twice with Cross-hatch, both angles burning the same slice', () => {
    const groups = rasterGroups(scene([gradient()], [imageLayer({ imageCrossHatch: true })]));
    expect(groups).toHaveLength(8);
    expect(groups.map((group) => group.scanAngleDeg ?? 0)).toEqual([0, 90, 0, 90, 0, 90, 0, 90]);
    const burnedCells = groups.map((group) => rows(group).filter((value) => value > 0).length);
    expect(burnedCells[0]).toBe(burnedCells[1]);
    expect(burnedCells[6]).toBe(burnedCells[7]);
    expect(burnedCells[0]).toBeLessThan(burnedCells[6] ?? 0);
  });

  it('streams the same rows as it materializes', () => {
    const layer = imageLayer();
    const image = gradient();
    const materialized = compileRasterGroupsForLayer([image], layer, DEVICE).groups;
    const streamed = compileRasterGroupsForLayer([image], layer, DEVICE, {
      streamedPixelThreshold: 1,
    }).groups;
    expect(streamed.every((group) => group.rowProvider !== undefined)).toBe(true);
    expect(streamed.map(rows)).toEqual(materialized.map(rows));
  });

  it('leaves Pass-Through and the other modes as one group of all passes', () => {
    for (const settings of [{ passThrough: true }, { ditherAlgorithm: 'grayscale' as const }]) {
      const groups = rasterGroups(scene([gradient()], [imageLayer(settings)]));
      expect(groups).toHaveLength(1);
      expect(groups[0]?.passes).toBe(4);
    }
  });
});

function plate(): SceneObject {
  const square = (min: number, size: number) => ({
    closed: true,
    points: [
      { x: min, y: min },
      { x: min + size, y: min },
      { x: min + size, y: min + size },
      { x: min, y: min + size },
      { x: min, y: min },
    ],
  });
  return {
    kind: 'imported-svg',
    id: 'plate',
    source: 'stamp.svg',
    bounds: { minX: 20, minY: 20, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#0000ff', polylines: [square(20, 20), square(27, 6)] }],
  };
}

function fillLayer(settings: Partial<Layer> = {}): Layer {
  return {
    ...createLayer({ id: 'fill', color: '#0000ff', mode: 'fill' }),
    hatchSpacingMm: 1,
    power: 60,
    minPower: 10,
    fillRampLengthMm: 3,
    ...settings,
  };
}

describe('Fill Ramp compilation (ADR-699)', () => {
  it('burns a ramped Fill as a raster graded from Min power to Power', () => {
    const job = compileJob(scene([plate()], [fillLayer()]), DEVICE);
    expect(job.groups.map((group) => group.kind)).toEqual(['raster']);
    const group = job.groups[0] as RasterGroup;
    expect(group.layerId).toBe('fill');
    const values = rows(group).filter((value) => value > 0);
    const full = Math.round(0.6 * DEVICE.maxPowerS);
    expect(Math.max(...values)).toBe(full);
    expect(Math.min(...values)).toBeGreaterThan(Math.round(0.1 * DEVICE.maxPowerS));
    expect(Math.min(...values)).toBeLessThan(full);
    expect(job.diagnostics ?? []).toEqual([]);
  });

  it('keeps the flat Fill without a ramp, at 0, and for Follow Shape', () => {
    for (const settings of [
      { fillRampLengthMm: undefined },
      { fillRampLengthMm: 0 },
      { fillStyle: 'offset' as const },
    ]) {
      const job = compileJob(scene([plate()], [fillLayer(settings)]), DEVICE);
      expect(job.groups.map((group) => group.kind)).toEqual(['fill']);
    }
  });

  it('compiles a ramp-free Fill to the same job as before the ramp existed', () => {
    const { fillRampLengthMm: _ramp, ...withoutRamp } = fillLayer();
    const before = compileJob(scene([plate()], [withoutRamp]), DEVICE);
    const off = compileJob(scene([plate()], [fillLayer({ fillRampLengthMm: 0 })]), DEVICE);
    expect(off).toEqual(before);
  });

  it('burns flat, with a warning, when the ramp grid is too large', () => {
    const job = compileJob(scene([plate()], [fillLayer({ hatchSpacingMm: 0.005 })]), DEVICE);
    expect(job.groups.map((group) => group.kind)).toEqual(['fill']);
    expect(job.diagnostics).toEqual([
      expect.objectContaining({ kind: 'fill-ramp-too-large', layerName: 'Operation' }),
    ]);
  });

  it('treats an absent ramp as off when operations are compared', () => {
    const { fillRampLengthMm: _ramp, ...withoutRamp } = fillLayer();
    expect(
      layerOperationOutputEqual(withoutRamp, {
        ...withoutRamp,
        fillRampLengthMm: 0,
        fillRampOuterEdge: false,
      }),
    ).toBe(true);
    expect(layerOperationOutputEqual(withoutRamp, fillLayer())).toBe(false);
  });
});
