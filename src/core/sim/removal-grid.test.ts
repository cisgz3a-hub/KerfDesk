import { describe, expect, it } from 'vitest';
import { coarsenedCellSize, createRemovalGrid } from './removal-grid';

describe('createRemovalGrid', () => {
  it('rejects non-finite stock dimensions instead of returning a malformed grid', () => {
    const result = createRemovalGrid({
      originX: 0,
      originY: 0,
      widthMm: Number.NaN,
      heightMm: 10,
      mmPerCell: 1,
    });

    expect(result).toEqual({
      kind: 'error',
      reason: 'Removal grid width must be a finite positive number.',
    });
  });

  it('rejects non-finite requested cell sizes', () => {
    const result = coarsenedCellSize(10, 10, Number.POSITIVE_INFINITY);

    expect(result).toEqual({
      kind: 'error',
      reason: 'Removal grid cell size must be a finite positive number.',
    });
  });
});
