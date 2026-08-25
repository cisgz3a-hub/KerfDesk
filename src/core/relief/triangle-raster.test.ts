import { describe, expect, it } from 'vitest';
import { rasterizeTriangleMaxZ, type RasterTarget } from './triangle-raster';

const REQUESTED_CELL_MM = 0.3;
const EXTENT_MM = 1;
const CELL_COUNT = 4;
const NOMINAL_EXTENT = EXTENT_MM / REQUESTED_CELL_MM;

function target(): RasterTarget {
  const maxZ = new Float32Array(CELL_COUNT * CELL_COUNT);
  maxZ.fill(Number.NEGATIVE_INFINITY);
  return {
    widthCells: CELL_COUNT,
    heightCells: CELL_COUNT,
    widthMm: EXTENT_MM,
    heightMm: EXTENT_MM,
    mmPerCell: REQUESTED_CELL_MM,
    maxZ,
  };
}

function rasterizeOneCellRamp(mmPerCell: number, widthMm = 1, heightMm = 1): number {
  const maxZ = new Float32Array(1);
  maxZ.fill(Number.NEGATIVE_INFINITY);
  const output: RasterTarget = {
    widthCells: 1,
    heightCells: 1,
    widthMm,
    heightMm,
    mmPerCell,
    maxZ,
  };
  const nominalWidth = widthMm / mmPerCell;
  const nominalHeight = heightMm / mmPerCell;
  rasterizeTriangleMaxZ(output, 0, 0, 0, nominalWidth, 0, 10, nominalWidth, nominalHeight, 10);
  rasterizeTriangleMaxZ(output, 0, 0, 0, nominalWidth, nominalHeight, 10, 0, nominalHeight, 0);
  return output.maxZ[0] ?? Number.NEGATIVE_INFINITY;
}

describe('rasterizeTriangleMaxZ partial cells', () => {
  it('interpolates at the actual terminal-cell center', () => {
    const output = target();
    rasterizeTriangleMaxZ(
      output,
      0,
      0,
      0,
      NOMINAL_EXTENT,
      0,
      10,
      NOMINAL_EXTENT,
      NOMINAL_EXTENT,
      10,
    );
    rasterizeTriangleMaxZ(
      output,
      0,
      0,
      0,
      NOMINAL_EXTENT,
      NOMINAL_EXTENT,
      10,
      0,
      NOMINAL_EXTENT,
      0,
    );

    for (let row = 0; row < CELL_COUNT; row += 1) {
      const offset = row * CELL_COUNT;
      expect([...output.maxZ.slice(offset, offset + CELL_COUNT)]).toEqual([1.5, 4.5, 7.5, 9.5]);
    }
  });

  it('preserves regular-grid center interpolation exactly', () => {
    const maxZ = new Float32Array(4);
    maxZ.fill(Number.NEGATIVE_INFINITY);
    const output: RasterTarget = {
      widthCells: 2,
      heightCells: 2,
      widthMm: 1,
      heightMm: 1,
      mmPerCell: 0.5,
      maxZ,
    };
    rasterizeTriangleMaxZ(output, 0, 0, 0, 2, 0, 2, 2, 2, 2);
    rasterizeTriangleMaxZ(output, 0, 0, 0, 2, 2, 2, 0, 2, 0);

    expect([...output.maxZ]).toEqual([0.5, 1.5, 0.5, 1.5]);
  });

  it('preserves the regular-grid sub-threshold degeneracy boundary', () => {
    const maxZ = new Float32Array(1);
    maxZ.fill(Number.NEGATIVE_INFINITY);
    const output: RasterTarget = {
      widthCells: 1,
      heightCells: 1,
      widthMm: 1,
      heightMm: 1,
      mmPerCell: 1,
      maxZ,
    };
    rasterizeTriangleMaxZ(output, 0, 0.5 - 1e-13, 5, 1, 0.5, 5, 0, 0.5 + 1e-13, 5);

    expect(output.maxZ[0]).toBe(Number.NEGATIVE_INFINITY);
  });

  it.each([1, 2_000_000, Number.MAX_VALUE])(
    'keeps one-cell interpolation invariant at finite nominal scale %s',
    (mmPerCell) => {
      expect(rasterizeOneCellRamp(mmPerCell)).toBe(5);
    },
  );

  it('treats a finite non-zero triangle as valid independently of its aspect scale', () => {
    expect(rasterizeOneCellRamp(1, 1, 1e-15)).toBe(5);
  });
});
