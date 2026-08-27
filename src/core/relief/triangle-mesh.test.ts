import { describe, expect, it } from 'vitest';
import { meshBounds } from './triangle-mesh';

describe('meshBounds persisted-coordinate parity', () => {
  it('matches the established Float32 materializer for Float32-backed coordinates', () => {
    const persisted = [0.1, 0.2, 0.3, 2.0000001, 0, 1, 0, 1.5000001, 0];
    expect(meshBounds({ positions: Float32Array.from(persisted) })).toEqual({
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: Math.fround(2.0000001),
      maxY: Math.fround(1.5000001),
      maxZ: 1,
    });
  });

  it('retains finite Float64 bounds beyond the Float32 range', () => {
    const bounds = meshBounds({
      positions: Float64Array.from([0, 0, 0, Number.MAX_VALUE, 0, 1e39, 0, 1.5, 0]),
    });

    expect(bounds).toMatchObject({ maxX: Number.MAX_VALUE, maxY: 1.5, maxZ: 1e39 });
    expect(Object.values(bounds ?? {}).every(Number.isFinite)).toBe(true);
  });
});
