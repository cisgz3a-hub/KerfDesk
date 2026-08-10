import { describe, expect, it } from 'vitest';
import { DEFAULT_RELIEF_LAYER_COLOR, IDENTITY_TRANSFORM } from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { reliefObjectToHeightmap } from './relief-object-to-heightmap';

const FLOAT32_FRACTION_BITS = 23;
const FLOAT32_MAX_EXPONENT = 127;
const FLOAT32_MAX = Math.fround((2 - 2 ** -FLOAT32_FRACTION_BITS) * 2 ** FLOAT32_MAX_EXPONENT);

describe('reliefObjectToHeightmap legacy Float32 integrity', () => {
  it.each([
    ['X', 3],
    ['Y', 4],
  ] as const)('retains the existing non-finite %s bounds failure', (_axis, coordinateIndex) => {
    expect(materialize(Number.MAX_VALUE, coordinateIndex)).toEqual({
      kind: 'error',
      reason: 'Mesh bounds must be finite.',
    });
  });

  it.each([
    ['persisted finite overflow', Number.MAX_VALUE],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['NaN', Number.NaN],
  ] as const)('rejects non-finite materialized Z bounds from %s', (_label, z) => {
    expect(materialize(z)).toEqual({
      kind: 'error',
      reason: 'Mesh bounds must be finite.',
    });
  });

  it('keeps the greatest finite Float32 Z materializable', () => {
    const result = materialize(FLOAT32_MAX);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Array.from(result.heightmap.depth).every(Number.isFinite)).toBe(true);
  });
});

function materialize(value: number, coordinateIndex = 5) {
  return reliefObjectToHeightmap(legacyRelief(value, coordinateIndex), {
    targetWidthMm: 2,
    reliefDepthMm: 1,
    mmPerCell: 1,
  });
}

function legacyRelief(value: number, coordinateIndex: number): MeshReliefObject {
  const positions = [0, 0, 0, 2, 0, 1, 0, 1.5, 0].map((coordinate, index) =>
    index === coordinateIndex ? value : coordinate,
  );
  return {
    kind: 'relief',
    id: 'float32-z-integrity',
    source: 'float32-z-integrity.stl',
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: positions,
      emptyCells: 'floor',
    },
    targetWidthMm: 2,
    reliefDepthMm: 1,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
    transform: IDENTITY_TRANSFORM,
  };
}
