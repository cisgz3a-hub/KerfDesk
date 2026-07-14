import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import {
  addLayer,
  addObject,
  EMPTY_SCENE,
  assignObjectToLayer,
  moveLayer,
  recolorLayer,
  removeLayer,
  removeObject,
  updateLayer,
} from './scene';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
  bounds: { minX: 0, minY: 0, maxX: 5, maxY: 5 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ],
    },
    {
      color: '#0000ff',
      polylines: [
        {
          closed: false,
          points: [
            { x: 2, y: 2 },
            { x: 3, y: 3 },
          ],
        },
      ],
    },
  ],
};

const sampleRaster: SceneObject = {
  kind: 'raster-image',
  id: 'R1',
  source: 'r.png',
  dataUrl: 'data:,',
  pixelWidth: 1,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'grayscale',
  linesPerMm: 10,
};

describe('Scene object operations', () => {
  it('addObject appends without mutating the input', () => {
    const next = addObject(EMPTY_SCENE, sampleObject);
    expect(next.objects).toHaveLength(1);
    expect(EMPTY_SCENE.objects).toHaveLength(0); // input untouched
  });

  it('removeObject filters by id and is a no-op on unknown id', () => {
    const withObject = addObject(EMPTY_SCENE, sampleObject);
    expect(removeObject(withObject, 'O1').objects).toHaveLength(0);
    expect(removeObject(withObject, 'unknown').objects).toHaveLength(1);
  });

  it('assignObjectToLayer rewrites every vector path color without mutating input', () => {
    const withObject = addObject(EMPTY_SCENE, sampleObject);
    const assigned = assignObjectToLayer(withObject, 'O1', '#00FF00');
    const obj = assigned.objects[0];
    expect(obj?.kind).toBe('imported-svg');
    if (obj?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(obj.paths.map((path) => path.color)).toEqual(['#00ff00', '#00ff00']);
    expect(sampleObject.paths.map((path) => path.color)).toEqual(['#ff0000', '#0000ff']);
  });

  it('assignObjectToLayer rewrites raster image color', () => {
    const withObject = addObject(EMPTY_SCENE, sampleRaster);
    const assigned = assignObjectToLayer(withObject, 'R1', '#00ff00');
    expect(assigned.objects[0]).toMatchObject({ kind: 'raster-image', color: '#00ff00' });
  });

  it('rejects invalid target layer colors', () => {
    const withObject = addObject(EMPTY_SCENE, sampleObject);
    expect(() => assignObjectToLayer(withObject, 'O1', 'red')).toThrow(/Invalid layer color/);
    expect(withObject.objects[0]).toBe(sampleObject);
  });
});

describe('Scene layer operations', () => {
  it('addLayer → updateLayer → removeLayer roundtrips cleanly', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const withLayer = addLayer(EMPTY_SCENE, layer);
    expect(withLayer.layers).toHaveLength(1);

    const updated = updateLayer(withLayer, 'L1', { power: 50, speed: 2000 });
    expect(updated.layers[0]?.power).toBe(50);
    expect(updated.layers[0]?.speed).toBe(2000);
    expect(updated.layers[0]?.id).toBe('L1');

    expect(removeLayer(updated, 'L1').layers).toHaveLength(0);
  });

  it('updateLayer on unknown id is a no-op', () => {
    const layer = createLayer({ id: 'L1', color: '#ff0000' });
    const withLayer = addLayer(EMPTY_SCENE, layer);
    expect(updateLayer(withLayer, 'L2', { power: 99 }).layers[0]?.power).toBe(30);
  });

  it('moveLayer reorders layers without mutating the original scene', () => {
    const red = createLayer({ id: 'red', color: '#ff0000' });
    const blue = createLayer({ id: 'blue', color: '#0000ff' });
    const green = createLayer({ id: 'green', color: '#00ff00' });
    const scene = { ...EMPTY_SCENE, layers: [red, blue, green] };

    const moved = moveLayer(scene, 'green', 'up');

    expect(moved.layers.map((layer) => layer.id)).toEqual(['red', 'green', 'blue']);
    expect(scene.layers.map((layer) => layer.id)).toEqual(['red', 'blue', 'green']);
  });

  it('moveLayer is a no-op at the list boundary or for an unknown layer', () => {
    const red = createLayer({ id: 'red', color: '#ff0000' });
    const blue = createLayer({ id: 'blue', color: '#0000ff' });
    const scene = { ...EMPTY_SCENE, layers: [red, blue] };

    expect(moveLayer(scene, 'red', 'up')).toBe(scene);
    expect(moveLayer(scene, 'blue', 'down')).toBe(scene);
    expect(moveLayer(scene, 'missing', 'up')).toBe(scene);
  });

  it('recolors one layer key across matching artwork while preserving other colors', () => {
    const red = createLayer({ id: 'stable-red-id', color: '#ff0000' });
    const blue = createLayer({ id: 'blue', color: '#0000ff' });
    const object = {
      ...sampleObject,
      cncTabAnchors: [{ layerColor: '#ff0000', pathIndex: 0, polylineIndex: 0, pathT: 0.25 }],
    };
    const scene = { ...EMPTY_SCENE, layers: [red, blue], objects: [object] };

    const recolored = recolorLayer(scene, 'stable-red-id', '#00FF00');

    expect(recolored.layers[0]).toMatchObject({ id: 'stable-red-id', color: '#00ff00' });
    const result = recolored.objects[0];
    expect(result?.kind).toBe('imported-svg');
    if (result?.kind !== 'imported-svg') throw new Error('expected imported svg');
    expect(result.paths.map((path) => path.color)).toEqual(['#00ff00', '#0000ff']);
    expect(result.cncTabAnchors?.[0]?.layerColor).toBe('#00ff00');
    expect(scene.objects[0]).toBe(object);
  });

  it('does not merge layer settings when the requested color already exists', () => {
    const red = createLayer({ id: 'red', color: '#ff0000' });
    const blue = createLayer({ id: 'blue', color: '#0000ff' });
    const scene = { ...EMPTY_SCENE, layers: [red, blue], objects: [sampleObject] };

    expect(recolorLayer(scene, 'red', '#0000ff')).toBe(scene);
  });
});
