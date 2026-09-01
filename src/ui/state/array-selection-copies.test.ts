import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type SceneObject } from '../../core/scene';
import { copyObjectsAtArrayPlacement, placedObject } from './array-selection-copies';

describe('copyObjectsAtArrayPlacement', () => {
  it('deep-copies sources and remaps copied dependencies at the placement', () => {
    const guide = object('guide');
    const raster: SceneObject = {
      kind: 'raster-image',
      id: 'image',
      source: 'image.png',
      dataUrl: 'data:image/png;base64,AA==',
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      color: '#000000',
      dither: 'grayscale',
      linesPerMm: 1,
      lumaBase64: 'AA==',
      imageMaskId: guide.id,
    };
    let nextId = 0;

    const copied = copyObjectsAtArrayPlacement(
      [guide, raster],
      { dx: 12, dy: 3, rotationDeg: 0 },
      () => `copy-${nextId++}`,
    );

    expect(copied.objects.map((item) => item.transform)).toEqual([
      { ...IDENTITY_TRANSFORM, x: 12, y: 3 },
      { ...IDENTITY_TRANSFORM, x: 12, y: 3 },
    ]);
    expect(copied.objects[1]).toMatchObject({ id: 'copy-1', imageMaskId: 'copy-0' });
    expect(copied.objects[0]).not.toBe(guide);
  });

  it.each([360, -360])('treats a %d-degree pivot turn as exact identity', (rotationDeg) => {
    const source = {
      ...object('source'),
      transform: { ...IDENTITY_TRANSFORM, x: 7, y: 11, rotationDeg: 23 },
    };

    const placed = placedObject(source, {
      dx: 0,
      dy: 0,
      rotationDeg,
      pivot: { x: 100, y: -50 },
    });

    expect(placed.transform).toEqual(source.transform);
  });
});

function object(id: string): SceneObject {
  return {
    kind: 'shape',
    id,
    spec: { kind: 'rect', widthMm: 1, heightMm: 1, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#000000',
    paths: [],
  };
}
