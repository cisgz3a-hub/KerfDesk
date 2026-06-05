import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import {
  addLayer,
  addObject,
  EMPTY_SCENE,
  moveLayer,
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
  paths: [],
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
});
