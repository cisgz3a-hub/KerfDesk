import { describe, expect, it } from 'vitest';
import { compileJob } from '../../core/job';
import {
  captureLayerOperationSettings,
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';

function sourceRaster(): RasterImage {
  return {
    kind: 'raster-image',
    id: 'source-photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,AAAAAA==',
    lumaBase64: 'AAAAAA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#224466',
    operationIds: ['photo-operation'],
    operationOverride: { power: 47 },
    powerScale: 80,
    dither: 'ordered',
    linesPerMm: 9,
  };
}

function rasterizedTrace(id = 'raster-trace'): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: 'photo.png (bitmap)',
    dataUrl: 'data:image/png;base64,AAAAAA==',
    lumaBase64: 'AAAAAA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 2, minY: 3, maxX: 18, maxY: 9 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function imageOperation(): Layer {
  return {
    ...createLayer({ id: 'photo-operation', color: '#336699', mode: 'image' }),
    power: 63,
    speed: 777,
    passes: 2,
    ditherAlgorithm: 'atkinson',
    linesPerMm: 13.5,
    imageBidirectional: false,
  };
}

function projectWithSource(...additional: RasterImage[]): Project {
  const base = createProject();
  return {
    ...base,
    scene: {
      ...base.scene,
      objects: [sourceRaster(), ...additional],
      layers: [imageOperation()],
    },
  };
}

function committedRaster(project: Project, id = 'raster-trace'): RasterImage {
  const result = project.scene.objects.find(
    (object): object is RasterImage => object.kind === 'raster-image' && object.id === id,
  );
  if (result === undefined) throw new Error(`missing committed raster ${id}`);
  return result;
}

describe('applyRasterizedTraceToExisting', () => {
  it('keeps the source as render-only and reuses its complete Image operation', () => {
    const project = projectWithSource();
    const originalOperation = project.scene.layers[0];
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      'source-photo',
      rasterizedTrace(),
    );
    const source = committedRaster(result.project, 'source-photo');
    const output = committedRaster(result.project);

    expect(source.role).toBe('trace-source');
    expect(output).toMatchObject({
      traceSourceId: 'source-photo',
      color: source.color,
      operationIds: ['photo-operation'],
      operationOverride: { ...source.operationOverride, negativeImage: false },
      powerScale: source.powerScale,
      dither: source.dither,
      linesPerMm: source.linesPerMm,
    });
    expect(output.role).toBeUndefined();
    expect(result.project.scene.layers).toEqual([originalOperation]);

    const groups = compileJob(result.project.scene, result.project.device).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'raster',
      sourceObjectId: output.id,
      layerId: 'photo-operation',
      power: 37.6,
      speed: 777,
      passes: 2,
      bidirectional: false,
    });
  });

  it('can delete the source without pruning the operation now used by the result', () => {
    const project = projectWithSource();
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      'source-photo',
      rasterizedTrace(),
      { deleteSourceAfterTrace: true },
    );
    const output = committedRaster(result.project);

    expect(result.project.scene.objects.some((object) => object.id === 'source-photo')).toBe(false);
    expect(output.operationIds).toEqual(['photo-operation']);
    expect(result.project.scene.layers.map((layer) => layer.id)).toContain('photo-operation');
  });

  it('removes the previous trace result during Re-trace Original', () => {
    const prior = {
      ...rasterizedTrace('prior-result'),
      traceSourceId: 'source-photo',
      operationIds: ['photo-operation'],
    };
    const project = projectWithSource(prior);
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      'source-photo',
      rasterizedTrace('replacement'),
      { replaceTraceId: prior.id },
    );

    expect(result.project.scene.objects.some((object) => object.id === prior.id)).toBe(false);
    expect(committedRaster(result.project, 'replacement').traceSourceId).toBe('source-photo');
  });

  it('replaces a same-id Re-trace result in place without changing order or groups', () => {
    const before = { ...rasterizedTrace('before'), operationIds: ['photo-operation'] };
    const prior = {
      ...rasterizedTrace('stable-result'),
      source: 'old trace',
      traceSourceId: 'source-photo',
      operationIds: ['photo-operation'],
    };
    const after = { ...rasterizedTrace('after'), operationIds: ['photo-operation'] };
    const seeded = projectWithSource(before, prior, after);
    const artworkOrder = ['source-photo', before.id, prior.id, after.id];
    const groups = [{ id: 'trace-group', name: 'Trace group', objectIds: [before.id, prior.id] }];
    const project: Project = {
      ...seeded,
      scene: { ...seeded.scene, artworkOrder, groups },
    };
    const replacement = { ...rasterizedTrace(prior.id), source: 'updated trace' };

    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      'source-photo',
      replacement,
      { replaceTraceId: prior.id },
    );

    expect(result.project.scene.objects.map((object) => object.id)).toEqual(artworkOrder);
    expect(result.project.scene.artworkOrder).toBe(artworkOrder);
    expect(result.project.scene.groups).toBe(groups);
    expect(committedRaster(result.project, prior.id).source).toBe('updated trace');
  });

  it('creates a fresh Image operation when the source has no usable Image binding', () => {
    const {
      operationIds: _operationIds,
      operationOverride: _operationOverride,
      ...sourceWithoutBinding
    } = sourceRaster();
    const source: RasterImage = {
      ...sourceWithoutBinding,
      color: '#aa0000',
    };
    const lineLayer: Layer = {
      ...createLayer({ id: 'line-operation', color: source.color, mode: 'line' }),
      power: 72,
      speed: 888,
      ditherAlgorithm: 'burkes',
      linesPerMm: 7.5,
    };
    const base = createProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [source], layers: [lineLayer] },
    };
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      source.id,
      rasterizedTrace(),
    );
    const output = committedRaster(result.project);
    const operation = primaryOperationForObject(output, result.project.scene.layers);

    expect(operation).not.toBeNull();
    expect(operation?.id).not.toBe(lineLayer.id);
    expect(operation).toMatchObject({
      mode: 'image',
      power: lineLayer.power,
      speed: lineLayer.speed,
      ditherAlgorithm: lineLayer.ditherAlgorithm,
      linesPerMm: lineLayer.linesPerMm,
    });
  });

  it('forces only the fallback result to Image mode when the source overrides Line mode', () => {
    const source: RasterImage = {
      ...sourceRaster(),
      operationOverride: { mode: 'line', power: 47 },
    };
    const base = createProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [source], layers: [imageOperation()] },
    };

    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      source.id,
      rasterizedTrace(),
    );
    const output = committedRaster(result.project);
    const operation = primaryOperationForObject(output, result.project.scene.layers);
    const groups = compileJob(result.project.scene, result.project.device).groups;

    expect(output.operationIds).not.toEqual(source.operationIds);
    expect(output.operationOverride).toEqual({ mode: 'image', power: 47, negativeImage: false });
    expect(operation?.mode).toBe('image');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'raster', sourceObjectId: output.id });
  });

  it('reuses the parent binding when the effective Image operation is a sublayer', () => {
    const source = sourceRaster();
    const parent = createLayer({ id: 'photo-operation', color: '#336699', mode: 'line' });
    const imageSubLayer = createLayerSubLayer(parent, {
      id: 'image-pass',
      label: 'Image pass',
      settings: {
        ...captureLayerOperationSettings(parent),
        mode: 'image',
        power: 58,
        speed: 654,
        linesPerMm: 11,
      },
    });
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [source],
        layers: [{ ...parent, subLayers: [imageSubLayer] }],
      },
    };
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      source.id,
      rasterizedTrace(),
    );
    const output = committedRaster(result.project);
    const groups = compileJob(result.project.scene, result.project.device).groups;

    expect(output.operationIds).toEqual([parent.id]);
    expect(result.project.scene.layers).toHaveLength(1);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'raster',
      sourceObjectId: output.id,
      layerId: `${parent.id}:${imageSubLayer.id}`,
      power: 37.6,
      speed: 654,
    });
  });

  it('does not reuse a disabled Image sublayer that the dialog could not snapshot', () => {
    const source = sourceRaster();
    const parent = createLayer({ id: 'photo-operation', color: '#336699', mode: 'line' });
    const disabledImage = createLayerSubLayer(parent, {
      id: 'disabled-image',
      label: 'Disabled image',
      enabled: false,
      settings: { ...captureLayerOperationSettings(parent), mode: 'image' },
    });
    const base = createProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [source],
        layers: [{ ...parent, subLayers: [disabledImage] }],
      },
    };

    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      source.id,
      rasterizedTrace(),
    );
    const output = committedRaster(result.project);

    expect(output.operationIds).toHaveLength(1);
    expect(output.operationIds).not.toEqual([parent.id]);
    expect(primaryOperationForObject(output, result.project.scene.layers)?.mode).toBe('image');
  });

  it('keeps black trace ink powered and white background off on a negative source layer', () => {
    const source = sourceRaster();
    const negativeOperation: Layer = {
      ...imageOperation(),
      ditherAlgorithm: 'threshold',
      negativeImage: true,
      passThrough: true,
    };
    const base = createProject();
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [source], layers: [negativeOperation] },
    };
    const binaryTrace: RasterImage = {
      ...rasterizedTrace(),
      pixelWidth: 2,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      lumaBase64: 'AP8=',
    };

    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      source.id,
      binaryTrace,
    );
    const output = committedRaster(result.project);
    const group = compileJob(result.project.scene, result.project.device).groups[0];

    expect(output.operationOverride).toEqual({ power: 47, negativeImage: false });
    expect(group?.kind).toBe('raster');
    if (group?.kind !== 'raster') throw new Error('expected raster group');
    expect([...group.sValues]).toEqual([376, 0]);
  });

  it('adds a safe fresh Image operation when the source disappeared', () => {
    const project = createProject();
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      'missing-source',
      rasterizedTrace(),
    );
    const output = committedRaster(result.project);
    const operation = primaryOperationForObject(output, result.project.scene.layers);

    expect(output.traceSourceId).toBe('missing-source');
    expect(operation).toMatchObject({
      mode: 'image',
      ditherAlgorithm: output.dither,
      linesPerMm: output.linesPerMm,
    });
  });

  it('records the whole atomic swap as one undo entry and clears stale selection', () => {
    const project = projectWithSource();
    const result = applyRasterizedTraceToExisting(
      { project, undoStack: [] },
      'source-photo',
      rasterizedTrace(),
    );

    expect(result.undoStack).toEqual([project]);
    expect(result.redoStack).toEqual([]);
    expect(result.selectedObjectId).toBe('raster-trace');
    expect(result.additionalSelectedIds).toEqual(new Set());
    expect(result.dirty).toBe(true);
  });
});
