import { describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_RELIEF_LAYER_COLOR, IDENTITY_TRANSFORM } from '../../core/scene';
import type { HeightfieldReliefObject, MeshReliefObject } from '../../core/scene/relief';
import { resolveReliefMachineWidth } from './relief-machine-width-resolution';

describe('resolveReliefMachineWidth', () => {
  it('keeps ordinary representable division on the stored-width path', () => {
    expect(resolveReliefMachineWidth(heightfieldRelief(-0.5), 75)).toEqual({
      kind: 'stored-width',
      targetWidthMm: 150,
    });
  });

  it('keeps exact-zero compatibility on the stored-width path', () => {
    expect(resolveReliefMachineWidth(heightfieldRelief(0), 75)).toEqual({
      kind: 'stored-width',
      targetWidthMm: 75,
    });
  });

  it.each([
    ['divide underflow', 2, Number.MIN_VALUE],
    ['divide overflow', Number.MIN_VALUE, 1],
  ] as const)('rebases a heightfield after %s', (_label, scaleX, machineWidthMm) => {
    const initial = heightfieldRelief(scaleX);
    const result = resolveReliefMachineWidth(initial, machineWidthMm);

    expect(result.kind).toBe('rebased');
    if (result.kind !== 'rebased' || result.relief.reliefSource.kind !== 'heightfield-v1') return;
    expect(result.relief).toMatchObject({
      targetWidthMm: machineWidthMm,
      bounds: { minX: 0, minY: 0, maxX: machineWidthMm, maxY: 0.5 },
      transform: { scaleX: scaleX < 0 ? -1 : 1 },
      reliefSource: {
        physicalWidthMm: machineWidthMm,
        physicalHeightMm: 0.5,
        mapping: { aspect: 'stretch' },
        revision: initial.reliefSource.revision + 1,
      },
    });
  });

  it.each([
    ['divide underflow', -2, Number.MIN_VALUE],
    ['divide overflow', -Number.MIN_VALUE, 1],
  ] as const)(
    'rebases a legacy mesh after %s and preserves source identity',
    (_label, scaleX, machineWidthMm) => {
      const initial = meshRelief(scaleX);
      const result = resolveReliefMachineWidth(initial, machineWidthMm);

      expect(result.kind).toBe('rebased');
      if (result.kind !== 'rebased' || result.relief.reliefSource.kind !== 'legacy-mesh') return;
      expect(result.relief).toMatchObject({
        targetWidthMm: machineWidthMm,
        targetHeightMm: 0.5,
        widthAspect: 'stretch',
        bounds: { minX: 0, minY: 0, maxX: machineWidthMm, maxY: 0.5 },
        transform: { scaleX: -1 },
      });
      expect(result.relief.reliefSource).toBe(initial.reliefSource);
    },
  );
});

function heightfieldRelief(scaleX: number): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'field',
    source: 'field.png',
    targetWidthMm: 1,
    reliefDepthMm: 1,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 1,
      physicalHeightMm: 0.5,
      maxDepthMm: 1,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    transform: { ...IDENTITY_TRANSFORM, scaleX },
  };
}

function meshRelief(scaleX: number): MeshReliefObject {
  return {
    kind: 'relief',
    id: 'mesh',
    source: 'mesh.stl',
    targetWidthMm: 1,
    reliefDepthMm: 1,
    ...testLegacyMeshGeometry({
      positions: [0, 0, 0, 2, 0, 1, 0, 1, 0],
      targetWidthMm: 1,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    transform: { ...IDENTITY_TRANSFORM, scaleX },
  };
}
