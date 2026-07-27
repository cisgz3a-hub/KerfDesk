// Perceptual test harness — raster fidelity scoring glue.
//
// Wires the three raster pieces together so a test reads as one sentence:
// compile a fixture, score what it emits against what its bitmap demanded.
// Both fields are built on the SAME machine-mm window and cell grid, which is
// the only way the subtraction in density-compare.ts means anything.
//
// The window deliberately extends past the artwork by SCORING_PAD_MM. Ink
// that lands outside the image bounds — an origin error, a runaway overscan
// that arms the laser, a rotation placing content off its own footprint — then
// registers as density in cells whose truth is zero, instead of being clipped
// away and scored as if it never happened.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import { compareDensityFields, type DensityMetrics } from './density-compare';
import { gcodeBurnDensity, type DensityField, type MachineRect } from './gcode-burn-density';
import { imageDensityTruth, type DensityGrid, type SourceTone } from './image-density-truth';
import type { RasterFixture } from './raster-burn-fixtures';

/** Machine-mm of empty bed kept inside the scoring window on every side. */
export const SCORING_PAD_MM = 8;

export type TruthBitmap = {
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly tone: SourceTone;
  // Defaults match an unmirrored image on a front-left-origin device: the
  // image's top row burns at the back of the bed (machine max Y), its left
  // column at machine min X.
  readonly rowZeroAt?: 'max-y' | 'min-y';
  readonly columnZeroAt?: 'min-x' | 'max-x';
};

export function densityGridAround(rect: MachineRect, cells: number): DensityGrid {
  return {
    window: {
      minX: rect.minX - SCORING_PAD_MM,
      minY: rect.minY - SCORING_PAD_MM,
      maxX: rect.maxX + SCORING_PAD_MM,
      maxY: rect.maxY + SCORING_PAD_MM,
    },
    cellsX: cells,
    cellsY: cells,
  };
}

/**
 * What the emitted program will burn. Pass `gcode` to score a deliberately
 * corrupted program instead of the fixture's own — that is how the regression
 * suite proves the metric can actually fail.
 */
export function burnedDensity(
  fixture: RasterFixture,
  grid: DensityGrid,
  gcode?: string,
): DensityField {
  return gcodeBurnDensity(gcode ?? fixture.gcode, {
    window: grid.window,
    cellsX: grid.cellsX,
    cellsY: grid.cellsY,
    sMax: fixture.sMax,
    lineIntervalMm: fixture.lineIntervalMm,
  });
}

/** What the source bitmap demanded, on the same grid and in the same units. */
export function demandedDensity(
  bitmap: TruthBitmap,
  fixture: RasterFixture,
  grid: DensityGrid,
): DensityField {
  return imageDensityTruth(
    {
      luma: bitmap.luma,
      width: bitmap.width,
      height: bitmap.height,
      rect: fixture.rect,
      tone: bitmap.tone,
      ...(bitmap.rowZeroAt === undefined ? {} : { rowZeroAt: bitmap.rowZeroAt }),
      ...(bitmap.columnZeroAt === undefined ? {} : { columnZeroAt: bitmap.columnZeroAt }),
    },
    grid,
  );
}

export function scoreRasterBurn(
  fixture: RasterFixture,
  bitmap: TruthBitmap,
  cells: number,
  gcode?: string,
): DensityMetrics {
  const grid = densityGridAround(fixture.rect, cells);
  return compareDensityFields(
    burnedDensity(fixture, grid, gcode),
    demandedDensity(bitmap, fixture, grid),
  );
}
