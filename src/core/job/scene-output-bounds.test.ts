import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { createLayer, IDENTITY_TRANSFORM, type Scene, type SceneObject } from '../scene';
import { computeSceneOutputBounds } from './scene-output-bounds';

describe('computeSceneOutputBounds', () => {
  it('uses the compiled vector output bounds, including line kerf compensation', () => {
    const color = '#ff0000';
    const square: SceneObject = {
      kind: 'imported-svg',
      id: 'square',
      source: 'square.svg',
      bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color,
          polylines: [
            {
              closed: true,
              points: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
                { x: 20, y: 20 },
                { x: 10, y: 20 },
              ],
            },
          ],
        },
      ],
    };
    const scene: Scene = {
      objects: [square],
      layers: [{ ...createLayer({ id: color, color, mode: 'line' }), kerfOffsetMm: 1 }],
    };

    expect(computeSceneOutputBounds(scene, DEFAULT_DEVICE_PROFILE)).toEqual({
      minX: 9,
      minY: 379,
      maxX: 21,
      maxY: 391,
    });
  });
});
