import { describe, expect, it } from 'vitest';
import { legacyMeshIntrinsicBounds } from './legacy-mesh-intrinsic-bounds';

describe('legacyMeshIntrinsicBounds', () => {
  it('persists the exact bounds seen after Float32 conversion', () => {
    expect(legacyMeshIntrinsicBounds([0.1, 0.2, 0.3, 2.0000001, 0, 1, 0, 1.5000001, 0])).toEqual({
      kind: 'finite-float32-v1',
      minX: Math.fround(0),
      minY: Math.fround(0),
      minZ: Math.fround(0),
      maxX: Math.fround(2.0000001),
      maxY: Math.fround(1.5000001),
      maxZ: Math.fround(1),
    });
  });

  it.each([
    ['X', [0, 0, 0, Number.MAX_VALUE, 0, 1, 0, 1.5, 0]],
    ['Y', [0, 0, 0, 2, Number.MAX_VALUE, 1, 0, 1.5, 0]],
    ['Z', [0, 0, 0, 2, 0, Number.MAX_VALUE, 0, 1.5, 0]],
  ] as const)('records a non-finite marker for Float32 %s overflow', (_axis, positions) => {
    expect(legacyMeshIntrinsicBounds(positions)).toEqual({ kind: 'non-finite-float32-v1' });
  });

  it('canonicalizes negative zero for stable JSON equality', () => {
    const result = legacyMeshIntrinsicBounds([-0, -0, -0, 1, 0, 0, 0, 1, 1]);
    expect(result.kind).toBe('finite-float32-v1');
    if (result.kind !== 'finite-float32-v1') return;
    expect(Object.is(result.minX, -0)).toBe(false);
    expect(Object.is(result.minY, -0)).toBe(false);
    expect(Object.is(result.minZ, -0)).toBe(false);
  });
});
