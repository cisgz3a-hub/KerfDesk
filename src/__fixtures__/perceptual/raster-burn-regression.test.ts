// Raster burn fidelity — negative controls.
//
// "A metric that passes everything is worse than none." raster-burn-fidelity
// shows the score passes correct output; this file is the other half of the
// argument, and the one that gives the thresholds there any authority: each
// test injects a regression that a real bug could produce, then asserts the
// score COLLAPSES. Without these, a harness that always returned 0 error would
// look identical to a working one.
//
// Two shapes of injection, both applied to the genuine emitted program:
//   - corrupt the G-code text (shift it, flatten its power, drop scan rows) —
//     stands in for an emitter or origin regression;
//   - keep the G-code and score it against a different truth (inverted,
//     mirrored, unrotated) — stands in for the pipeline having applied that
//     wrong transform upstream.
//
// The last test is not a failure but a documented blind spot, asserted so it
// stays documented: correlation alone cannot see a uniform energy scale.

import { describe, expect, it } from 'vitest';
import {
  compileRasterFixture,
  horizontalRampLuma,
  invertLuma,
  mirrorLumaX,
  quadrantLuma,
  transposeLuma,
  type RasterFixture,
} from './raster-burn-fixtures';
import { scoreRasterBurn } from './raster-burn-scoring';

const PX = 32;
const SCENE = { minX: 100, minY: 100, maxX: 132, maxY: 132 };
const CELLS = 12;
// The fidelity suite's tightest passing bound for a modulated ramp. Every
// collapse below is stated as a multiple of it, so the two files cannot drift.
const PASSING_MEAN_ABSOLUTE_ERROR = 0.001;

function rampFixture(): RasterFixture {
  return compileRasterFixture({
    luma: horizontalRampLuma(PX, PX),
    width: PX,
    height: PX,
    sceneBounds: SCENE,
    ditherAlgorithm: 'grayscale',
  });
}

function rampBitmap() {
  return { luma: horizontalRampLuma(PX, PX), width: PX, height: PX, tone: 'linear' as const };
}

/** Displace the whole program — an origin, work-offset or scan-offset error. */
function shiftWord(gcode: string, word: 'X' | 'Y', deltaMm: number): string {
  return gcode.replace(
    new RegExp(`${word}(-?\\d+(?:\\.\\d+)?)`, 'g'),
    (_match, value: string) => `${word}${(Number(value) + deltaMm).toFixed(3)}`,
  );
}

/** Every burn at full power — power modulation lost between dither and emit. */
function flattenPower(gcode: string, sMax: number): string {
  return gcode.replace(/S(\d+)/g, (_match, value: string) =>
    Number(value) > 0 ? `S${sMax}` : 'S0',
  );
}

/** Half the scan rows never emitted — a row-provider or skip-row regression. */
function dropAlternateRows(gcode: string): string {
  const kept: string[] = [];
  let sweepIndex = -1;
  for (const line of gcode.split('\n')) {
    if (/^G0 .*Y/.test(line)) sweepIndex += 1;
    if (sweepIndex < 0 || sweepIndex % 2 === 0) kept.push(line);
  }
  return kept.join('\n');
}

describe('the raster fidelity metric fails on injected regressions', () => {
  it('collapses when the tone is inverted', () => {
    const fixture = rampFixture();

    const metrics = scoreRasterBurn(
      fixture,
      { luma: invertLuma(horizontalRampLuma(PX, PX)), width: PX, height: PX, tone: 'linear' },
      CELLS,
    );

    // Measured 0.230 — 2600× the passing bound.
    expect(metrics.meanAbsoluteError).toBeGreaterThan(PASSING_MEAN_ABSOLUTE_ERROR * 100);
    expect(metrics.correlation).toBeLessThan(0.3);
  });

  it('collapses when the image is mirrored in X', () => {
    const luma = quadrantLuma(PX, PX);
    const fixture = compileRasterFixture({
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'threshold',
    });

    const metrics = scoreRasterBurn(
      fixture,
      { luma: mirrorLumaX(luma, PX, PX), width: PX, height: PX, tone: 'threshold' },
      CELLS,
    );

    // Disjoint quadrants: measured r = -0.125.
    expect(metrics.correlation).toBeLessThan(0);
    expect(metrics.meanAbsoluteError).toBeGreaterThan(0.2);
  });

  it('collapses when a rotated raster is scored against its unrotated artwork', () => {
    // The regression this stands in for is real and was fixed once already:
    // rotationDeg ignored, so the canvas showed a rotated image and the burn
    // did not (core/job/compile-job-raster-rotation.test.ts).
    const luma = quadrantLuma(PX, PX);
    const fixture = compileRasterFixture({
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'threshold',
      rotationDeg: 90,
    });

    const rotated = scoreRasterBurn(
      fixture,
      {
        luma: transposeLuma(luma, PX, PX),
        width: PX,
        height: PX,
        tone: 'threshold',
        rowZeroAt: 'max-y',
        columnZeroAt: 'max-x',
      },
      CELLS,
    );
    const unrotated = scoreRasterBurn(
      fixture,
      { luma, width: PX, height: PX, tone: 'threshold' },
      CELLS,
    );

    expect(rotated.meanAbsoluteError).toBeLessThan(1e-9);
    expect(unrotated.correlation).toBeLessThan(0);
  });

  it('collapses when power modulation is flattened to full power', () => {
    const fixture = rampFixture();

    const metrics = scoreRasterBurn(
      fixture,
      rampBitmap(),
      CELLS,
      flattenPower(fixture.gcode, fixture.sMax),
    );

    // Every non-zero pixel now burns at sMax: measured mean 0.431 vs 0.222.
    expect(metrics.predictedMean).toBeGreaterThan(metrics.truthMean * 1.5);
    expect(metrics.meanAbsoluteError).toBeGreaterThan(PASSING_MEAN_ABSOLUTE_ERROR * 100);
  });

  it('collapses when half the scan rows are never emitted', () => {
    const fixture = rampFixture();

    const metrics = scoreRasterBurn(fixture, rampBitmap(), CELLS, dropAlternateRows(fixture.gcode));

    // Measured: mean energy exactly halved, 0.111 vs 0.222.
    expect(metrics.predictedMean).toBeLessThan(metrics.truthMean * 0.75);
    expect(metrics.meanAbsoluteError).toBeGreaterThan(PASSING_MEAN_ABSOLUTE_ERROR * 50);
  });

  it('sees a displacement of a quarter of one cell', () => {
    const fixture = rampFixture();
    const oneMillimetre = 1; // cells are 4 mm across

    const shiftedX = scoreRasterBurn(
      fixture,
      rampBitmap(),
      CELLS,
      shiftWord(fixture.gcode, 'X', oneMillimetre),
    );
    const shiftedY = scoreRasterBurn(
      fixture,
      rampBitmap(),
      CELLS,
      shiftWord(fixture.gcode, 'Y', oneMillimetre),
    );

    // Measured 0.025 (X) and 0.014 (Y) against a 0.001 passing bound.
    expect(shiftedX.meanAbsoluteError).toBeGreaterThan(PASSING_MEAN_ABSOLUTE_ERROR * 10);
    expect(shiftedY.meanAbsoluteError).toBeGreaterThan(PASSING_MEAN_ABSOLUTE_ERROR * 10);
  });
});

describe('documented blind spot', () => {
  it('cannot detect a uniform energy loss by correlation alone', () => {
    const fixture = rampFixture();

    const metrics = scoreRasterBurn(fixture, rampBitmap(), CELLS, dropAlternateRows(fixture.gcode));

    // Half the energy is gone, yet the shape is untouched, so r stays pinned
    // at ~1. This is why density-compare reports meanAbsoluteError as well,
    // and why every fidelity assertion must use both numbers.
    expect(metrics.correlation).toBeGreaterThan(0.99);
    expect(metrics.predictedMean).toBeLessThan(metrics.truthMean * 0.75);
  });
});
