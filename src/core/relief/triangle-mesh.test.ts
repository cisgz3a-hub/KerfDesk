import { describe, expect, it } from 'vitest';
import { meshBounds } from './triangle-mesh';

describe('meshBounds persisted-coordinate parity', () => {
  it.each([
    ['finite Float32 rounding', [0.1, 0.2, 0.3, 2.0000001, 0, 1, 0, 1.5000001, 0]],
    ['Float32 overflow', [0, 0, 0, Number.MAX_VALUE, 0, 1, 0, 1.5, 0]],
  ] as const)('matches materializer conversion for %s', (_label, persisted) => {
    expect(meshBounds({ positions: persisted })).toEqual(
      meshBounds({ positions: Float32Array.from(persisted) }),
    );
  });

  it('uses trusted metadata only for a nonempty mesh and never rescans it', () => {
    expect(
      meshBounds({
        positions: [],
        intrinsicBounds: { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
      }),
    ).toBeNull();
    const positions = new Array<number>(9).fill(0);
    Object.defineProperty(positions, 0, {
      get: () => {
        throw new Error('bounds scan should not read positions');
      },
    });
    const intrinsicBounds = { minX: 0, minY: 0, minZ: 0, maxX: 2, maxY: 1, maxZ: 3 };
    expect(meshBounds({ positions, intrinsicBounds })).toBe(intrinsicBounds);
  });
});
