// R6: offsetClosedPolylinesForKerf calls clipper2-ts' inflatePathsD outside the
// F1 boundary, so an internal clipper throw (pathological geometry) used to
// escape the pure core and abort the compile/generator. With clipper mocked to
// throw, the offset must return its empty "no usable contours" contract, not
// propagate the throw.

import { describe, expect, it, vi } from 'vitest';

vi.mock('clipper2-ts', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    inflatePathsD: (): never => {
      throw new Error('clipper boom');
    },
  };
});

import type { Polyline } from '../scene';
import { offsetClosedPolylinesForKerf } from './kerf-offset';

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

describe('offsetClosedPolylinesForKerf (R6 clipper boundary)', () => {
  it('returns [] instead of propagating a clipper throw', () => {
    expect(() => offsetClosedPolylinesForKerf([SQUARE], 2)).not.toThrow();
    expect(offsetClosedPolylinesForKerf([SQUARE], 2)).toEqual([]);
  });
});
