import { describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import { applyReliefParamPatch } from './relief-param-patch-application';

describe('applyReliefParamPatch', () => {
  it('applies an exact machine Width rebase before a depth patch', () => {
    const source = testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 1,
      physicalHeightMm: 0.5,
      maxDepthMm: 1,
    });
    const result = applyReliefParamPatch(relief(source, 2), {
      machineWidthMm: Number.MIN_VALUE,
      reliefDepthMm: 2,
    });

    expect(result).toMatchObject({
      targetWidthMm: Number.MIN_VALUE,
      reliefDepthMm: 2,
      transform: { scaleX: 1 },
      reliefSource: { physicalWidthMm: Number.MIN_VALUE },
    });
  });

  it('keeps a legacy source owner while updating explicit target geometry', () => {
    const geometry = testLegacyMeshGeometry({
      positions: [0, 0, 0, 2, 0, 1, 0, 1, 0],
      targetWidthMm: 1,
    });
    const initial = relief(geometry.reliefSource, 1, geometry);
    const result = applyReliefParamPatch(initial, { targetWidthMm: 2 });

    expect(result).toMatchObject({ targetWidthMm: 2, targetHeightMm: 1 });
    expect(result.reliefSource).toBe(initial.reliefSource);
  });
});

function relief(
  reliefSource: ReliefObject['reliefSource'],
  scaleX: number,
  geometry: Partial<ReliefObject> = {},
): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief',
    source: 'relief',
    targetWidthMm: 1,
    reliefDepthMm: 1,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 0.5 },
    transform: { ...IDENTITY_TRANSFORM, scaleX },
    reliefSource,
    ...geometry,
  } as ReliefObject;
}
