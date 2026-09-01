import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import {
  createLayer,
  createProject,
  operationIdsForObject,
  type RasterImage,
  type SceneObject,
  type ShapeObject,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { projectWithVariants, shapeObject } from './testing/scene-clipboard-fixtures';

describe('scene clipboard operation ownership', () => {
  beforeEach(() => resetStore());

  it('preserves source settings across a cross-document operation-id collision', () => {
    const sourceOperation = operation('shared-operation', '#000000', 321, 22);
    const sourceObject = {
      ...shapeObject(),
      id: 'source-object',
      operationIds: [sourceOperation.id],
    };
    copyFromSource(sourceObject, [sourceOperation]);

    const targetOperation = operation(sourceOperation.id, '#000000', 999, 88);
    const targetObject = {
      ...shapeObject(),
      id: 'target-object',
      operationIds: [targetOperation.id],
    };
    pasteIntoTarget([targetOperation], [targetObject]);

    const scene = useStore.getState().project.scene;
    const pasted = scene.objects.find((object) => object.id !== targetObject.id);
    const [pastedOperationId] =
      pasted === undefined ? [] : operationIdsForObject(pasted, scene.layers);
    expect(pastedOperationId).not.toBe(targetOperation.id);
    expect(scene.layers.find((candidate) => candidate.id === pastedOperationId)).toMatchObject({
      speed: sourceOperation.speed,
      power: sourceOperation.power,
    });
  });

  it('materializes a raster fallback instead of adopting a colliding missing operation', () => {
    const sourceRaster = rasterFixture({
      operationIds: ['missing-operation'],
      operationOverride: { speed: 321, power: 22 },
    });
    copyFromSource(sourceRaster, []);
    const targetOperation = operation('missing-operation', '#808080', 999, 88, 'image');

    pasteIntoTarget([targetOperation]);

    expectPastedRasterOutput(targetOperation.id, 321, 22);
  });

  it('keeps mixed path bindings away from a colliding missing target operation', () => {
    const sourceOperation = operation('good-operation', '#000000', 321, 22);
    const sourceObject = mixedPathObject(sourceOperation.id, 'missing-operation');
    copyFromSource(sourceObject, [sourceOperation]);
    const targetOperation = operation('missing-operation', '#000000', 999, 88);

    pasteIntoTarget([targetOperation]);

    expectOnlySourcePathCompiles(sourceOperation.speed, sourceOperation.power, targetOperation);
  });

  it('protects a missing path id that collides with a generated source-operation id', () => {
    const sourceOperation = operation('good-operation', '#000000', 321, 22);
    const sourceObject = mixedPathObject(sourceOperation.id, 'operation-mixed-source');
    copyFromSource(sourceObject, [sourceOperation]);

    pasteIntoTarget([]);

    const scene = useStore.getState().project.scene;
    const pasted = pastedShape();
    const [validPathId] = pasted.paths[0]?.operationIds ?? [];
    const [missingPathId] = pasted.paths[1]?.operationIds ?? [];
    expect(validPathId).toBe('operation-mixed-source');
    expect(missingPathId).not.toBe(validPathId);
    expect(scene.layers.some((candidate) => candidate.id === missingPathId)).toBe(false);
    expect(compileJob(scene, DEFAULT_DEVICE_PROFILE).groups).toEqual([
      expect.objectContaining({ kind: 'cut', speed: 321, power: 22 }),
    ]);
  });

  it('keeps an unowned raster from inheriting another copied object operation', () => {
    const sourceOperation = operation('source-operation', '#ff0000', 321, 22);
    const sourceShape = {
      ...shapeObject(),
      id: 'source-shape',
      operationIds: [sourceOperation.id],
    };
    const sourceRaster = rasterFixture({
      color: '#000000',
      operationOverride: { speed: 777, power: 66 },
    });
    const source = createProject();
    useStore.setState({
      project: {
        ...source,
        scene: {
          ...source.scene,
          objects: [sourceShape, sourceRaster],
          layers: [sourceOperation],
        },
      },
    });
    useStore.getState().selectObjects([sourceShape.id, sourceRaster.id]);
    useStore.getState().copySelection();

    pasteIntoTarget([]);

    const scene = useStore.getState().project.scene;
    const pastedRaster = scene.objects.find(
      (object): object is RasterImage => object.kind === 'raster-image',
    );
    if (pastedRaster === undefined) throw new Error('pasted raster missing');
    const [rasterOperationId] = operationIdsForObject(pastedRaster, scene.layers);
    expect(scene.layers.find((candidate) => candidate.id === rasterOperationId)).toMatchObject({
      mode: 'image',
      speed: 777,
      power: 66,
    });
    expect(compileJob(scene, DEFAULT_DEVICE_PROFILE).groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'cut', speed: 321, power: 22 }),
        expect.objectContaining({ kind: 'raster', speed: 777, power: 66 }),
      ]),
    );
  });

  it('materializes source-less legacy vector color instead of adopting target settings', () => {
    const sourceObject = {
      ...shapeObject(),
      id: 'legacy-vector',
      operationOverride: { speed: 321 },
    };
    copyFromSource(sourceObject, []);
    const targetOperation = operation('target-operation', '#000000', 999, 88);

    pasteIntoTarget([targetOperation]);

    const scene = useStore.getState().project.scene;
    const pasted = pastedShape();
    const [pastedOperationId] = operationIdsForObject(pasted, scene.layers);
    expect(pastedOperationId).not.toBe(targetOperation.id);
    expect(compileJob(scene, DEFAULT_DEVICE_PROFILE).groups).toEqual([
      expect.objectContaining({ kind: 'cut', speed: 321, power: 30 }),
    ]);
  });

  it('materializes source-less legacy raster color instead of adopting target settings', () => {
    const sourceRaster = rasterFixture({ operationOverride: { speed: 321, power: 22 } });
    copyFromSource(sourceRaster, []);
    const targetOperation = operation('target-operation', '#808080', 999, 88, 'image');

    pasteIntoTarget([targetOperation]);

    expectPastedRasterOutput(targetOperation.id, 321, 22);
  });
});

function operation(
  id: string,
  color: string,
  speed: number,
  power: number,
  mode: 'line' | 'image' = 'line',
) {
  return { ...createLayer({ id, color, mode }), speed, power };
}

function copyFromSource(object: SceneObject, layers: ReturnType<typeof operation>[]): void {
  const source = createProject();
  useStore.setState({
    project: { ...source, scene: { ...source.scene, objects: [object], layers } },
  });
  useStore.getState().selectObject(object.id);
  useStore.getState().copySelection();
}

function pasteIntoTarget(
  layers: ReturnType<typeof operation>[],
  objects: SceneObject[] = [],
): void {
  const target = createProject();
  useStore.getState().setProject({
    ...target,
    scene: { ...target.scene, objects, layers },
  });
  useStore.getState().pasteClipboard();
}

function mixedPathObject(validOperationId: string, missingOperationId: string): ShapeObject {
  const [basePath] = shapeObject().paths;
  if (basePath === undefined) throw new Error('shape path missing');
  return {
    ...shapeObject(),
    id: 'mixed-source',
    paths: [
      { ...basePath, operationIds: [validOperationId] },
      {
        ...basePath,
        operationIds: [missingOperationId],
        polylines: basePath.polylines.map((polyline) => ({
          ...polyline,
          points: polyline.points.map((point) => ({ x: point.x + 10, y: point.y })),
        })),
      },
    ],
  };
}

function rasterFixture(overrides: Partial<RasterImage>): RasterImage {
  const raster = projectWithVariants().scene.objects.find(
    (object): object is RasterImage => object.kind === 'raster-image',
  );
  if (raster === undefined) throw new Error('source raster missing');
  return {
    ...raster,
    id: 'source-raster',
    pixelWidth: 1,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    ...overrides,
  };
}

function pastedShape(): ShapeObject {
  const pasted = useStore
    .getState()
    .project.scene.objects.find((object): object is ShapeObject => object.kind === 'shape');
  if (pasted === undefined) throw new Error('pasted shape missing');
  return pasted;
}

function expectOnlySourcePathCompiles(
  sourceSpeed: number,
  sourcePower: number,
  targetOperation: ReturnType<typeof operation>,
): void {
  const scene = useStore.getState().project.scene;
  const pasted = pastedShape();
  expect(operationIdsForObject(pasted, scene.layers)).not.toContain(targetOperation.id);
  expect(pasted.paths[1]?.operationIds).not.toContain(targetOperation.id);
  const groups = compileJob(scene, DEFAULT_DEVICE_PROFILE).groups;
  expect(groups).toEqual([
    expect.objectContaining({ kind: 'cut', speed: sourceSpeed, power: sourcePower }),
  ]);
  expect(groups).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ speed: targetOperation.speed, power: targetOperation.power }),
    ]),
  );
}

function expectPastedRasterOutput(targetOperationId: string, speed: number, power: number): void {
  const scene = useStore.getState().project.scene;
  const pasted = scene.objects.find(
    (object): object is RasterImage => object.kind === 'raster-image',
  );
  if (pasted === undefined) throw new Error('pasted raster missing');
  const [pastedOperationId] = operationIdsForObject(pasted, scene.layers);
  expect(pastedOperationId).toBeDefined();
  expect(pastedOperationId).not.toBe(targetOperationId);
  expect(scene.layers.find((candidate) => candidate.id === pastedOperationId)).toMatchObject({
    mode: 'image',
    speed,
    power,
  });
  expect(compileJob(scene, DEFAULT_DEVICE_PROFILE).groups).toEqual([
    expect.objectContaining({ kind: 'raster', sourceObjectId: pasted.id, speed, power }),
  ]);
}
