import { describe, expect, it } from 'vitest';
import { coarsenedCellSize, createRemovalGrid, gridCellOfPoint } from './removal-grid';

describe('createRemovalGrid', () => {
  it('reports an unchanged requested resolution explicitly', () => {
    const result = createRemovalGrid({
      originX: 0,
      originY: 0,
      widthMm: 10,
      heightMm: 10,
      mmPerCell: 0.2,
    });

    expect(result).toMatchObject({
      kind: 'ok',
      resolution: {
        requestedMmPerCell: 0.2,
        effectiveMmPerCell: 0.2,
        reason: null,
      },
      grid: {
        widthMm: 10,
        heightMm: 10,
        resolution: {
          requestedMmPerCell: 0.2,
          effectiveMmPerCell: 0.2,
          reason: null,
        },
      },
    });
  });

  it('keeps the requested pitch and stores an exact partial-edge domain', () => {
    const result = createRemovalGrid({
      originX: 10,
      originY: 20,
      widthMm: 1,
      heightMm: 0.5,
      mmPerCell: 0.3,
    });
    if (result.kind === 'error') throw new Error(result.reason);

    expect(result.grid).toMatchObject({
      widthCells: 4,
      heightCells: 2,
      widthMm: 1,
      heightMm: 0.5,
      mmPerCell: 0.3,
    });
    expect(gridCellOfPoint(result.grid, 10.95, 20.4)).toEqual({ cx: 3, cy: 1 });
    expect(gridCellOfPoint(result.grid, 11.01, 20.4)).toEqual({ cx: -1, cy: 1 });
  });

  it('reports the minimum-cell floor instead of silently rewriting the request', () => {
    const result = createRemovalGrid({
      originX: 0,
      originY: 0,
      widthMm: 1,
      heightMm: 1,
      mmPerCell: 0.0005,
    });

    expect(result).toMatchObject({
      kind: 'ok',
      resolution: {
        requestedMmPerCell: 0.0005,
        effectiveMmPerCell: 0.001,
        reason: 'minimum-cell-size',
      },
    });
  });

  it("retains a preview caller's original request and budget reason", () => {
    const result = createRemovalGrid({
      originX: 0,
      originY: 0,
      widthMm: 100,
      heightMm: 50,
      mmPerCell: 0.5,
      requestedMmPerCell: 0.2,
      resolutionReason: 'interactive-preview-cell-budget',
    });

    expect(result).toMatchObject({
      kind: 'ok',
      resolution: {
        requestedMmPerCell: 0.2,
        effectiveMmPerCell: 0.5,
        reason: 'interactive-preview-cell-budget',
      },
    });
  });

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

  it('reports automatic coarsening at the hard removal-grid cell budget', () => {
    const result = coarsenedCellSize(4_000, 4_000, 1);

    expect(result).toEqual({
      kind: 'ok',
      mmPerCell: 2,
      reason: 'removal-grid-cell-budget',
    });
  });
});
