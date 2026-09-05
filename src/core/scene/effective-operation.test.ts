import { describe, expect, it } from 'vitest';
import { captureLayerOperationSettings, createLayer, layerFromSubLayer } from './layer';
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

  it.each([
    { scope: undefined, expected: [17, 600] },
    { scope: { base: { power: 23 } }, expected: [23, 1000] },
    { scope: { base: null }, expected: [30, 1000] },
    { scope: { unrelated: { power: 90 } }, expected: [17, 600] },
  ])('resolves replacement scopes and explicit base inheritance: $scope', ({ scope, expected }) => {
    const layer = { ...createLayer({ id: 'base', color: '#000000' }), speed: 1000 };
    const object = {
      kind: 'imported-svg',
      id: 'art',
      source: 'art.svg',
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      operationOverride: {
        power: 17,
        speed: 600,
        ...(scope === undefined ? {} : { byOperation: scope }),
      },
    } as SceneObject;
    const effective = effectiveOperationForObject(layer, object);
    expect([effective.power, effective.speed]).toEqual(expected);
    expect(effective).not.toHaveProperty('byOperation');
  });

  it('resolves a child scope before its parent scope and keeps null child inheritance explicit', () => {
    const base = createLayer({ id: 'parent', color: '#000000' });
    const child = layerFromSubLayer(base, {
      id: 'finish',
      label: 'Finish',
      enabled: true,
      settings: { ...captureLayerOperationSettings(base), power: 8, speed: 400 },
    });
    const object = {
      kind: 'imported-svg',
      id: 'art',
      source: 'art.svg',
      paths: [],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      transform: IDENTITY_TRANSFORM,
      operationOverride: {
        power: 17,
        speed: 600,
        byOperation: { parent: { power: 23 }, 'parent:finish': { power: 11 } },
      },
    } as SceneObject;
    expect(effectiveOperationForObject(child, object)).toMatchObject({ power: 11, speed: 400 });
    expect(
      effectiveOperationForObject(child, {
        ...object,
        operationOverride: {
          power: 17,
          byOperation: { parent: { power: 23 }, 'parent:finish': null },
        },
      }),
    ).toMatchObject({ power: 8, speed: 400 });
    expect(
      effectiveOperationForObject(child, {
        ...object,
        operationOverride: { power: 17, byOperation: { parent: { power: 23 } } },
      }),
    ).toMatchObject({ power: 23, speed: 400 });
  });
});
