import { describe, expect, it } from 'vitest';
import { canonicalArtworkOrder } from './artwork-order';
import { moveObjectsInDrawOrder } from './draw-order';
import { IDENTITY_TRANSFORM, type Scene, type SceneObject } from './scene';

const ids = (scene: Scene) => scene.objects.map((object) => object.id);

describe('moveObjectsInDrawOrder', () => {
  const scene: Scene = { objects: ['a', 'b', 'c', 'd', 'e'].map(rect), layers: [] };

  it('brings a selection to the front and sends it to the back, keeping its own order', () => {
    expect(ids(moveObjectsInDrawOrder(scene, new Set(['b', 'd']), 'front'))).toEqual([
      'a',
      'c',
      'e',
      'b',
      'd',
    ]);
    expect(ids(moveObjectsInDrawOrder(scene, new Set(['b', 'd']), 'back'))).toEqual([
      'b',
      'd',
      'a',
      'c',
      'e',
    ]);
  });

  it('steps a selected run forward or backward one place together', () => {
    expect(ids(moveObjectsInDrawOrder(scene, new Set(['b', 'c']), 'forward'))).toEqual([
      'a',
      'd',
      'b',
      'c',
      'e',
    ]);
    expect(ids(moveObjectsInDrawOrder(scene, new Set(['b', 'c']), 'backward'))).toEqual([
      'b',
      'c',
      'a',
      'd',
      'e',
    ]);
  });

  it('returns the same scene when nothing moves', () => {
    expect(moveObjectsInDrawOrder(scene, new Set(['e']), 'front')).toBe(scene);
    expect(moveObjectsInDrawOrder(scene, new Set(['a']), 'backward')).toBe(scene);
    expect(moveObjectsInDrawOrder(scene, new Set(['missing']), 'front')).toBe(scene);
  });

  it('never changes the machine output order, even for a legacy scene without one', () => {
    const before = canonicalArtworkOrder(scene);
    const moved = moveObjectsInDrawOrder(scene, new Set(['a']), 'front');
    expect(ids(moved)).toEqual(['b', 'c', 'd', 'e', 'a']);
    expect(canonicalArtworkOrder(moved)).toEqual(before);

    const partial: Scene = { ...scene, artworkOrder: ['e', 'c'] };
    const partialBefore = canonicalArtworkOrder(partial);
    expect(
      canonicalArtworkOrder(moveObjectsInDrawOrder(partial, new Set(['a', 'b']), 'front')),
    ).toEqual(partialBefore);
  });
});

function rect(id: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}
