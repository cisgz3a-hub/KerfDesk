import { describe, expect, it } from 'vitest';
import { testLegacyMeshGeometry } from '../../__fixtures__/legacy-relief';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  type ReliefObject,
} from '../../core/scene';
import type { HeightfieldReliefObject } from '../../core/scene/relief';
import {
  applyHeightfieldReliefPatch,
  hasReliefPatch,
  isNoOpHeightfieldMappingPatch,
  normalizeReliefPatch,
} from './relief-heightfield-param-patch';

const MAX_U16_CODE = 0xffff;
const INITIAL_LOW_CODE = 100;
const INITIAL_HIGH_CODE = 60_000;

function heightfieldRelief(): HeightfieldReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'levels-source.png',
    targetWidthMm: 90,
    reliefDepthMm: 7,
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 1,
      physicalWidthMm: 90,
      physicalHeightMm: 45,
      maxDepthMm: 7,
      samplesU16: [0, MAX_U16_CODE],
      inclusionMask: [0, 255],
      mapping: {
        inputLowCode: INITIAL_LOW_CODE,
        inputHighCode: INITIAL_HIGH_CODE,
        inclusionThreshold: 128,
      },
      provenance: { sourceName: 'levels-source.png' },
      revision: 4,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 90, maxY: 45 },
    transform: IDENTITY_TRANSFORM,
  };
}

function meshRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'R1',
    source: 'mesh.stl',
    targetWidthMm: 90,
    reliefDepthMm: 7,
    ...testLegacyMeshGeometry({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 1],
      targetWidthMm: 90,
    }),
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 90, maxY: 45 },
    transform: IDENTITY_TRANSFORM,
  };
}

describe('relief heightfield parameter patches', () => {
  it.each([
    ['low endpoint', { inputLowCode: 0 }],
    ['high endpoint', { inputHighCode: MAX_U16_CODE }],
    ['equal endpoints', { inputLowCode: 12_345, inputHighCode: 12_345 }],
    ['crossed endpoints', { inputLowCode: 50_000, inputHighCode: 10_000 }],
    ['minimum mask threshold', { inclusionThreshold: 1 }],
    ['maximum mask threshold', { inclusionThreshold: 255 }],
  ] as const)('applies an exact %s and advances only the canonical revision', (_label, patch) => {
    const relief = heightfieldRelief();
    const field = relief.reliefSource;

    const updated = applyHeightfieldReliefPatch(relief, {}, patch);

    expect(updated).toEqual({
      ...relief,
      reliefSource: {
        ...field,
        mapping: { ...field.mapping, ...patch },
        revision: 5,
      },
    });
    expect(updated.reliefSource.samplesBase64).toBe(field.samplesBase64);
    expect(updated.reliefSource.inclusionMask).toBe(field.inclusionMask);
    expect(updated.reliefSource.provenance).toBe(field.provenance);
    expect(updated.bounds).toBe(relief.bounds);
    expect(updated.transform).toBe(relief.transform);
  });

  it('normalizes exact endpoints without imposing an ordering rule', () => {
    const crossed = normalizeReliefPatch({ inputLowCode: 60_000, inputHighCode: 100 });
    expect(crossed).toEqual({ inputLowCode: 60_000, inputHighCode: 100 });
    expect(hasReliefPatch(crossed)).toBe(true);
  });

  it.each([
    -1,
    MAX_U16_CODE + 1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])('drops invalid numeric endpoint %s', (value) => {
    const normalized = normalizeReliefPatch({ inputLowCode: value, inputHighCode: value });
    expect(normalized).toEqual({});
    expect(hasReliefPatch(normalized)).toBe(false);
  });

  it('drops non-number endpoints received across a runtime boundary', () => {
    const normalized = Reflect.apply(normalizeReliefPatch, undefined, [
      { inputLowCode: '0', inputHighCode: null },
    ]);
    expect(normalized).toEqual({});
    expect(hasReliefPatch(normalized)).toBe(false);
  });

  it.each([0, 256, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'drops invalid mask threshold %s',
    (inclusionThreshold) => {
      const normalized = normalizeReliefPatch({ inclusionThreshold });
      expect(normalized).toEqual({});
      expect(hasReliefPatch(normalized)).toBe(false);
    },
  );

  it('recognizes same-value and legacy-mesh mapping-only no-ops', () => {
    const relief = heightfieldRelief();
    expect(
      isNoOpHeightfieldMappingPatch(relief, {
        inputLowCode: INITIAL_LOW_CODE,
        inputHighCode: INITIAL_HIGH_CODE,
      }),
    ).toBe(true);
    expect(isNoOpHeightfieldMappingPatch(relief, { inputLowCode: 200 })).toBe(false);
    expect(isNoOpHeightfieldMappingPatch(relief, { inclusionThreshold: 128 })).toBe(true);
    expect(isNoOpHeightfieldMappingPatch(relief, { inclusionThreshold: 255 })).toBe(false);
    expect(isNoOpHeightfieldMappingPatch(meshRelief(), { inputLowCode: 200 })).toBe(true);
    expect(isNoOpHeightfieldMappingPatch(meshRelief(), { inclusionThreshold: 64 })).toBe(true);
  });
});
