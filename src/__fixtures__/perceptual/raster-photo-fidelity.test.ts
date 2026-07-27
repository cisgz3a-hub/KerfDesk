// Raster burn fidelity — real image data and continuous tone.
//
// raster-burn-fidelity.test.ts scores procedural ramps and quadrants: smooth,
// low-frequency, and the friendliest possible input to a density metric. This
// file is the harder half.
//
// EVERY score here is asserted against the BLANK BASELINE — the error a
// program that burned nothing would score, which equals the truth mean. That
// matters because absolute error is only impressive relative to how much ink
// the image wanted. The committed asset is line art at 6.4% coverage, so its
// blank baseline is a mere 0.064; quoting "error 0.005" without that context
// would overstate the result by a wide margin. Stating the ratio keeps the
// numbers honest as fixtures change.
//
// GRID ALIGNMENT IS LOAD-BEARING. gcode-burn-density assigns each scan row
// wholly to the cell row containing its midpoint, so a cell height that is not
// an integer multiple of the scan pitch mis-attributes rows near the boundary.
// Measured on the continuous-tone field: 4 mm cells over a 1 mm pitch score
// 0.00012, while 4.5 mm cells score 0.04311 — a 360× penalty that is an
// artefact of the grid, not a pipeline defect. The 112 mm window below divides
// evenly by both cell counts used. See gcode-burn-density.ts.

import { describe, expect, it } from 'vitest';
import { ciBudgetMs } from '../ci-budget';
import { contoneLuma } from './contone-luma';
import { photoLuma } from './photo-luma';
import { compileRasterFixture, invertLuma, type RasterFixture } from './raster-burn-fixtures';
import { scoreRasterBurn } from './raster-burn-scoring';

const ASSET_PATH = 'src/__fixtures__/perceptual/assets/arch-house-langebaan-source.png';
const PX = 96;
// 96 px across 96 mm at 1 line/mm: machine scan grid matches the source grid,
// so no resample error is folded into the score. Window is 96 + 2×8 = 112 mm.
const SCENE = { minX: 40, minY: 40, maxX: 136, maxY: 136 };
const FINE_CELLS = 28; // 4 mm cells = exactly 4 scan rows, 4×4 source px
const COARSE_CELLS = 14; // 8 mm cells = exactly 8 scan rows, 8×8 source px
const BUDGET_MS = ciBudgetMs(15_000, 45_000);

function fixtureFor(
  luma: Uint8Array,
  ditherAlgorithm: 'grayscale' | 'floyd-steinberg',
): RasterFixture {
  return compileRasterFixture({
    luma,
    width: PX,
    height: PX,
    sceneBounds: SCENE,
    ditherAlgorithm,
  });
}

function bitmap(luma: Uint8Array) {
  return { luma, width: PX, height: PX, tone: 'linear' as const };
}

describe('raster burn fidelity — real image data', () => {
  it(
    'engraves a decoded PNG at a large margin over burning nothing',
    () => {
      const luma = photoLuma({ path: ASSET_PATH, width: PX, height: PX });

      const grayscale = scoreRasterBurn(fixtureFor(luma, 'grayscale'), bitmap(luma), COARSE_CELLS);
      const diffused = scoreRasterBurn(
        fixtureFor(luma, 'floyd-steinberg'),
        bitmap(luma),
        COARSE_CELLS,
      );

      // truthMean IS the blank baseline: the error of a program that emitted
      // no burn at all. Asserting the ratio, not the raw number, is what stops
      // a sparse fixture from flattering the metric.
      expect(grayscale.meanAbsoluteError).toBeLessThan(grayscale.truthMean / 50);
      expect(diffused.meanAbsoluteError).toBeLessThan(diffused.truthMean / 10);
      expect(grayscale.correlation).toBeGreaterThan(0.999);
      expect(diffused.correlation).toBeGreaterThan(0.99);
    },
    BUDGET_MS,
  );
});

describe('raster burn fidelity — continuous tone', () => {
  // 39.6% ink, full tonal range, detail down to 2 px. The blank baseline here
  // is 0.396, so the ratios below are real margins rather than the artefact of
  // a mostly-white fixture.
  it(
    'holds tone across a midtone-heavy field with detail at five scales',
    () => {
      const luma = contoneLuma(PX, PX);

      const grayscale = scoreRasterBurn(fixtureFor(luma, 'grayscale'), bitmap(luma), COARSE_CELLS);
      const diffused = scoreRasterBurn(
        fixtureFor(luma, 'floyd-steinberg'),
        bitmap(luma),
        COARSE_CELLS,
      );

      expect(grayscale.meanAbsoluteError).toBeLessThan(grayscale.truthMean / 1000);
      expect(diffused.meanAbsoluteError).toBeLessThan(diffused.truthMean / 20);
      expect(grayscale.correlation).toBeGreaterThan(0.9999);
      expect(diffused.correlation).toBeGreaterThan(0.995);
      // Total delivered energy must match what the image asked for, within 2%.
      // A dither may move ink around; it may not invent or lose it.
      expect(diffused.predictedMean).toBeGreaterThan(diffused.truthMean * 0.98);
      expect(diffused.predictedMean).toBeLessThan(diffused.truthMean * 1.02);
    },
    BUDGET_MS,
  );

  it(
    'still converges as the cell grows, on the hardest input available',
    () => {
      const luma = contoneLuma(PX, PX);
      const fixture = fixtureFor(luma, 'floyd-steinberg');

      const fine = scoreRasterBurn(fixture, bitmap(luma), FINE_CELLS);
      const coarse = scoreRasterBurn(fixture, bitmap(luma), COARSE_CELLS);

      // The premise the whole raster metric rests on: error diffusion trades
      // tone for local dot density, so averaging over more pixels must move the
      // score toward the source. If this ever fails, the thresholds above stop
      // meaning anything and should be deleted rather than widened.
      expect(coarse.meanAbsoluteError).toBeLessThan(fine.meanAbsoluteError);
      expect(coarse.correlation).toBeGreaterThan(fine.correlation);
    },
    BUDGET_MS,
  );

  it(
    'collapses on inverted tone, by energy rather than by correlation',
    () => {
      const luma = contoneLuma(PX, PX);
      const fixture = fixtureFor(luma, 'floyd-steinberg');

      const correct = scoreRasterBurn(fixture, bitmap(luma), COARSE_CELLS);
      const inverted = scoreRasterBurn(fixture, bitmap(invertLuma(luma)), COARSE_CELLS);

      expect(inverted.meanAbsoluteError).toBeGreaterThan(correct.meanAbsoluteError * 10);
      // Correlation is deliberately NOT asserted negative here. The scoring
      // window carries an 8 mm ring of empty bed on every side (so ink landing
      // outside the artwork is visible), and those cells read zero in BOTH
      // fields whichever way the tone runs. On a midtone-heavy image that
      // shared-zero ring drags r positive — measured +0.52 for a fully
      // inverted burn. Mean absolute error is the reliable inversion detector
      // on high-coverage artwork; correlation is not.
      expect(inverted.correlation).toBeLessThan(correct.correlation);
    },
    BUDGET_MS,
  );
});
