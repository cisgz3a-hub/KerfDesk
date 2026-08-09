import { describe, expect, it } from 'vitest';
import { partialCellCenter, partialCellEnd, partialCellStart } from '../../core/grid';
import type { PartialCellGrid } from '../../core/grid';
import {
  carveDepthTextureAxisUv,
  carveDepthTexturePartialAxes,
} from './viewer3d-depth-texture-coordinate';

const PARTIAL_GRID: PartialCellGrid = {
  widthCells: 4,
  heightCells: 3,
  widthMm: 1,
  heightMm: 0.65,
  mmPerCell: 0.3,
};

describe('carveDepthTextureAxisUv', () => {
  it('maps exact partial-cell centers onto their matching texel centers', () => {
    for (const [axis, cells] of [
      ['x', PARTIAL_GRID.widthCells],
      ['y', PARTIAL_GRID.heightCells],
    ] as const) {
      for (let index = 0; index < cells; index += 1) {
        const centerMm = partialCellCenter(PARTIAL_GRID, axis, index);
        expect(carveDepthTextureAxisUv(PARTIAL_GRID, axis, centerMm)).toBeCloseTo(
          (index + 0.5) / cells,
          14,
        );
      }
    }
  });

  it('maps every physical cell edge onto the corresponding texel edge', () => {
    for (let index = 0; index < PARTIAL_GRID.widthCells; index += 1) {
      expect(
        carveDepthTextureAxisUv(PARTIAL_GRID, 'x', partialCellStart(PARTIAL_GRID, 'x', index)),
      ).toBeCloseTo(index / PARTIAL_GRID.widthCells, 14);
      expect(
        carveDepthTextureAxisUv(PARTIAL_GRID, 'x', partialCellEnd(PARTIAL_GRID, 'x', index)),
      ).toBeCloseTo((index + 1) / PARTIAL_GRID.widthCells, 14);
    }
  });

  it('keeps the regular-axis normalization branch exactly unchanged', () => {
    const regular: PartialCellGrid = {
      widthCells: 4,
      heightCells: 2,
      widthMm: 1,
      heightMm: 0.5,
      mmPerCell: 0.25,
    };
    for (const coordinateMm of [-0.25, 0, 0.375, 1, 1.25]) {
      expect(carveDepthTextureAxisUv(regular, 'x', coordinateMm)).toBe(
        coordinateMm / regular.widthMm,
      );
    }
  });

  it('maps a one-cell partial axis across the complete texture interval', () => {
    const oneCell: PartialCellGrid = {
      widthCells: 1,
      heightCells: 1,
      widthMm: 0.1,
      heightMm: 0.2,
      mmPerCell: 0.3,
    };
    expect(carveDepthTextureAxisUv(oneCell, 'x', 0)).toBe(0);
    expect(carveDepthTextureAxisUv(oneCell, 'x', 0.05)).toBe(0.5);
    expect(carveDepthTextureAxisUv(oneCell, 'x', 0.1)).toBe(1);
  });

  it('publishes independent X/Y partial-axis flags for the shader', () => {
    expect(carveDepthTexturePartialAxes(PARTIAL_GRID)).toEqual({ x: 1, y: 1 });
    expect(
      carveDepthTexturePartialAxes({
        ...PARTIAL_GRID,
        heightCells: 2,
        heightMm: 0.6,
      }),
    ).toEqual({ x: 1, y: 0 });
  });
});
