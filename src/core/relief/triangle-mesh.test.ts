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
});
