import { describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type SceneObject } from './scene';
import {
  artworkOperationRuns,
  canonicalArtworkOrder,
  orderedArtworkObjects,
} from './artwork-order';

function artwork(id: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

describe('artwork output order', () => {
  it('uses persisted priority without changing scene object stacking', () => {
    const a = artwork('a');
    const b = artwork('b');
    const scene: Scene = { objects: [a, b], layers: [], artworkOrder: ['b', 'a'] };

    expect(orderedArtworkObjects(scene).map((object) => object.id)).toEqual(['b', 'a']);
    expect(scene.objects.map((object) => object.id)).toEqual(['a', 'b']);
  });

  it('ignores stale and duplicate ids, then appends unlisted artwork deterministically', () => {
    const scene: Scene = {
      objects: [artwork('a'), artwork('b'), artwork('c')],
      layers: [],
      artworkOrder: ['missing', 'b', 'b'],
    };

    expect(canonicalArtworkOrder(scene)).toEqual(['b', 'a', 'c']);
  });

  it('schedules independent operations by artwork priority and unifies shared operations', () => {
    const firstLayer = createLayer({ id: 'first-op', color: '#2563eb' });
    const secondLayer = createLayer({ id: 'second-op', color: '#dc2626' });
    const first = { ...artwork('first'), operationIds: [firstLayer.id] };
    const second = { ...artwork('second'), operationIds: [secondLayer.id] };
    const scene: Scene = {
      objects: [first, second],
      layers: [firstLayer, secondLayer],
      artworkOrder: ['second', 'first'],
    };

    expect(artworkOperationRuns(scene).map((run) => run.layer.id)).toEqual([
      'second-op',
      'first-op',
    ]);
    expect(
      artworkOperationRuns({
        ...scene,
        objects: [
          { ...first, operationIds: [firstLayer.id] },
          { ...second, operationIds: [firstLayer.id] },
        ],
      }).map((run) => run.layer.id),
    ).toEqual(['first-op']);
  });
});
