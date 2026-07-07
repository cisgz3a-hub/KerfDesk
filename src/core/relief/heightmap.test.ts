import { describe, expect, it } from 'vitest';
import { heightmapCellSize } from './heightmap';

describe('heightmapCellSize', () => {
  it('rejects non-finite target dimensions instead of returning a malformed cell size', () => {
    const result = heightmapCellSize(Number.POSITIVE_INFINITY, 10, 1);

    expect(result).toEqual({
      kind: 'error',
      reason: 'Heightmap width must be a finite positive number.',
    });
  });
});
