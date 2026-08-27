import { describe, expect, it } from 'vitest';
import { DEFAULT_RELIEF_LAYER_COLOR, IDENTITY_TRANSFORM } from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { reliefObjectToHeightmap } from './relief-object-to-heightmap';

describe('reliefObjectToHeightmap finite legacy coordinates', () => {
  it.each([
    ['X', Number.MAX_VALUE, 3],
    ['Z', Number.MAX_VALUE, 5],
  ] as const)(
    'materializes finite %s beyond Float32 without non-finite depth',
    (_axis, value, at) => {
      const result = materialize(value, at);

      expect(result.kind).toBe('ok');
      if (result.kind !== 'ok') return;
      expect(Array.from(result.heightmap.depth).every(Number.isFinite)).toBe(true);
      expect(Math.min(...result.heightmap.depth)).toBeGreaterThanOrEqual(-1);
      expect(Math.max(...result.heightmap.depth)).toBeLessThanOrEqual(0);
    },
  );

  it('preserves the normalized surface for a finite Z overflow source', () => {
    const large = materialize(1e39, 5);
    const reference = materialize(1, 5);

    expect(large.kind).toBe('ok');
    expect(reference.kind).toBe('ok');
    if (large.kind !== 'ok' || reference.kind !== 'ok') return;
    expect(large.heightmap.depth).toEqual(reference.heightmap.depth);
  });

  it('normalizes a finite Z span whose binary64 subtraction overflows', () => {
    const result = materializeRelief(legacyReliefWithZ([-Number.MAX_VALUE, 0, Number.MAX_VALUE]));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Array.from(result.heightmap.depth).every(Number.isFinite)).toBe(true);
  });

  it('keeps a flat extreme-Z surface at stock top', () => {
    const result = materializeRelief(
      legacyReliefWithZ([Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]),
    );

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Array.from(result.heightmap.depth)).toContain(0);
    expect(new Set(result.heightmap.depth)).toEqual(new Set([-1, 0]));
  });
});

function materialize(value: number, coordinateIndex: number) {
  return materializeRelief(legacyRelief(value, coordinateIndex));
}

function materializeRelief(relief: MeshReliefObject) {
  return reliefObjectToHeightmap(relief, {
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
    id: 'finite-overflow',
    source: 'finite-overflow.stl',
    reliefSource: { kind: 'legacy-mesh', meshPositions: positions, emptyCells: 'floor' },
    targetWidthMm: 2,
    reliefDepthMm: 1,
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1.5 },
    transform: IDENTITY_TRANSFORM,
  };
}

function legacyReliefWithZ(z: readonly [number, number, number]): MeshReliefObject {
  const relief = legacyRelief(1, 5);
  return {
    ...relief,
    reliefSource: {
      ...relief.reliefSource,
      meshPositions: [0, 0, z[0], 2, 0, z[1], 0, 1.5, z[2]],
    },
  };
}
