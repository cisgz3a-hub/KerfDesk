import { describe, expect, it } from 'vitest';
import { createLayer } from './layer';
import { effectiveOperationForObject } from './effective-operation';
import { IDENTITY_TRANSFORM, type SceneObject } from './scene-object';

describe('effectiveOperationForObject', () => {
  it('materializes all object-local output facts over the bound operation', () => {
    const layer = createLayer({ id: 'base', color: '#000000', mode: 'line' });
    const object: SceneObject = {
      kind: 'imported-svg',
      id: 'trace',
      source: 'trace.svg',
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      paths: [],
      operationOverride: {
        mode: 'fill',
        fillStyle: 'offset',
        hatchSpacingMm: 0.35,
        fillBidirectional: false,
        ditherAlgorithm: 'stucki',
        negativeImage: true,
      },
    };

    expect(effectiveOperationForObject(layer, object)).toMatchObject({
      id: 'base',
      mode: 'fill',
      fillStyle: 'offset',
      hatchSpacingMm: 0.35,
      fillBidirectional: false,
      ditherAlgorithm: 'stucki',
      negativeImage: true,
    });
    expect(layer.mode).toBe('line');
  });
});
