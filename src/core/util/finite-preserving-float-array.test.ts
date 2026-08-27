import { describe, expect, it } from 'vitest';
import {
  cachedFinitePreservingFloatArray,
  finitePreservingFloatArray,
} from './finite-preserving-float-array';

describe('finite-preserving mesh arrays', () => {
  it('retains the existing Float32 representation when every finite value fits', () => {
    const values = [0, 0.1, -20, 3.402_823_5e38];
    const array = finitePreservingFloatArray(values);

    expect(array).toBeInstanceOf(Float32Array);
    expect(array).toEqual(Float32Array.from(values));
  });

  it('uses Float64 only when Float32 would overflow a finite source', () => {
    const values = [0, 1e39, Number.MAX_VALUE];
    const array = finitePreservingFloatArray(values);

    expect(array).toBeInstanceOf(Float64Array);
    expect(Array.from(array)).toEqual(values);
    expect(Array.from(array).every(Number.isFinite)).toBe(true);
  });

  it('caches by immutable owner and source identity', () => {
    const owner = { meshPositions: [0, 0, 0, 1e39] as ReadonlyArray<number> };
    const first = cachedFinitePreservingFloatArray(owner, owner.meshPositions);
    const second = cachedFinitePreservingFloatArray(owner, owner.meshPositions);

    expect(first).toBe(second);
    expect(first).toBeInstanceOf(Float64Array);
  });
});
