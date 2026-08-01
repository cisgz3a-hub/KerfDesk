// Raster burn fidelity — the perceptual harness extended from vector paths to
// image engraving (ADR-025's blind spot; docs/architecture/08 lists "Laser F.2
// raster burn" fidelity as unverified).
//
// Every test here compiles a real bitmap through compileJob + grblStrategy,
// re-reads the emitted G-code as a burn-density field, and scores it against
// the density the source demanded. See gcode-burn-density.ts for what a
// "density" is and image-density-truth.ts for why the tone transfer is a
// required decision rather than a default.
//
// WHAT THESE NUMBERS PROVE: that the emitted program deposits the right amount
// of energy in the right place at cell scale — right tone, right position,
// right orientation, right power modulation. Thresholds sit roughly one order
// of magnitude above the measured value so a real regression breaks them; they
// are not slack.
//
// WHAT THEY DO NOT PROVE: anything below cell scale. Each cell here averages
// 4×4 or 8×8 source pixels, so any rearrangement of dots INSIDE a cell that
// preserves its count scores identically — dither banding, worming, moiré and
// directional artefacts are invisible to this metric by construction. Nor does
// it model beam width, spot overlap between adjacent scan lines, material
// response, or anything about how the burn actually looks on wood. It is a
// geometry-and-energy check on the program text, not a photograph.

import { describe, expect, it } from 'vitest';
import {
  compileRasterFixture,
  horizontalRampLuma,
  quadrantLuma,
  solidLuma,
  transposeLuma,
  verticalRampLuma,
} from './raster-burn-fixtures';
import { burnedDensity, densityGridAround, scoreRasterBurn } from './raster-burn-scoring';

const PX = 32;
// 32 px across 32 mm at 1 line/mm: the machine scan grid matches the source
// grid exactly, so no resample error is folded into the fidelity score.
const SCENE = { minX: 100, minY: 100, maxX: 132, maxY: 132 };
const FINE_CELLS = 12; // ≈4×4 source px per cell
const COARSE_CELLS = 6; // ≈8×8 source px per cell

describe('raster burn fidelity — grayscale power modulation', () => {
  it('reproduces a black-to-white ramp as a matching energy ramp', () => {
    const luma = horizontalRampLuma(PX, PX);
    const fixture = compileRasterFixture({
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'grayscale',
    });

    const metrics = scoreRasterBurn(
      fixture,
      { luma, width: PX, height: PX, tone: 'linear' },
      FINE_CELLS,
    );

    // Grayscale dither maps luma linearly to S, so the only error available is
    // the emitter rounding S to an integer: measured 8.9e-5, bounded at 1e-3.
    expect(metrics.meanAbsoluteError).toBeLessThan(0.001);
    expect(metrics.correlation).toBeGreaterThan(0.9999);
  });

  // A horizontal ramp is invariant under a Y flip, so it alone cannot see a
  // raster-orientation regression. Verified by mutation: forcing flipY=false in
  // compile-job-raster.ts orientRasterLumaForMachine leaves the horizontal-ramp
  // score untouched and drives this one to 0.222 mean error.
  it('reproduces a top-to-bottom ramp the right way up', () => {
    const luma = verticalRampLuma(PX, PX);
    const fixture = compileRasterFixture({
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'grayscale',
    });

    const metrics = scoreRasterBurn(
      fixture,
      { luma, width: PX, height: PX, tone: 'linear' },
      FINE_CELLS,
    );

    expect(metrics.meanAbsoluteError).toBeLessThan(0.001);
    expect(metrics.correlation).toBeGreaterThan(0.9999);
  });

  it('emits no burn at all for an all-white image', () => {
    const fixture = compileRasterFixture({
      luma: solidLuma(PX, PX, 255),
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'grayscale',
    });

    const field = burnedDensity(fixture, densityGridAround(fixture.rect, FINE_CELLS));

    expect(field.data.reduce((sum, value) => sum + value, 0)).toBe(0);
  });
});

describe('raster burn fidelity — dithered output at cell scale', () => {
  // The claim under test is the one that makes a raster metric possible at
  // all: error diffusion does not reproduce the source pixel-for-pixel, it
  // trades tone for local dot density. So the score must improve as cells grow
  // — and if it ever stops doing that, the "compare local grey density" premise
  // is broken and every threshold below it is meaningless.
  it('converges on the source tone as the cell grows, for every diffusion kernel', () => {
    const luma = horizontalRampLuma(PX, PX);
    for (const algorithm of ['floyd-steinberg', 'jarvis', 'atkinson'] as const) {
      const fixture = compileRasterFixture({
        luma,
        width: PX,
        height: PX,
        sceneBounds: SCENE,
        ditherAlgorithm: algorithm,
      });
      const bitmap = { luma, width: PX, height: PX, tone: 'linear' as const };

      const fine = scoreRasterBurn(fixture, bitmap, FINE_CELLS);
      const coarse = scoreRasterBurn(fixture, bitmap, COARSE_CELLS);

      expect(coarse.meanAbsoluteError).toBeLessThan(fine.meanAbsoluteError);
      // Measured for floyd-steinberg: 0.0149 fine, 0.0071 coarse.
      expect(fine.meanAbsoluteError).toBeLessThan(0.05);
      expect(coarse.meanAbsoluteError).toBeLessThan(0.025);
      expect(coarse.correlation).toBeGreaterThan(0.99);
    }
  });

  it('places a threshold-dithered quadrant exactly where the artwork is', () => {
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
      { luma, width: PX, height: PX, tone: 'threshold' },
      FINE_CELLS,
    );

    // Black/white artwork on a matched grid: the reconstruction is exact.
    expect(metrics.meanAbsoluteError).toBeLessThan(1e-9);
    expect(metrics.correlation).toBeGreaterThan(0.9999);
  });
});

describe('raster burn fidelity — rotation lands where the artwork is', () => {
  // A +90° object rotation maps source (row, col) onto the machine grid as
  // (col, row) with both axes running back from the far corner. The expected
  // field is therefore built from a plain array transpose — arithmetic that
  // shares no code with core/job/raster-rotated-sample.ts, whose inverse
  // transform is the thing being checked.
  const rotatedTruth = (luma: Uint8Array, tone: 'linear' | 'threshold') =>
    ({
      luma: transposeLuma(luma, PX, PX),
      width: PX,
      height: PX,
      tone,
      rowZeroAt: 'max-y',
      columnZeroAt: 'max-x',
    }) as const;

  it('rotates a quadrant to the transposed machine position', () => {
    const luma = quadrantLuma(PX, PX);
    const fixture = compileRasterFixture({
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'threshold',
      rotationDeg: 90,
    });

    const metrics = scoreRasterBurn(fixture, rotatedTruth(luma, 'threshold'), FINE_CELLS);

    expect(metrics.meanAbsoluteError).toBeLessThan(1e-9);
    expect(metrics.correlation).toBeGreaterThan(0.9999);
  });

  it('keeps the tone ramp intact through the rotation', () => {
    const luma = horizontalRampLuma(PX, PX);
    const fixture = compileRasterFixture({
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'grayscale',
      rotationDeg: 90,
    });

    const metrics = scoreRasterBurn(fixture, rotatedTruth(luma, 'linear'), FINE_CELLS);

    expect(metrics.meanAbsoluteError).toBeLessThan(0.001);
    expect(metrics.correlation).toBeGreaterThan(0.9999);
  });
});

describe('raster burn fidelity — scan direction', () => {
  // Bidirectional is the default; the reverse rows burn the same X interval
  // from the other end. One-way must land identically, or the snake ordering
  // has introduced a half-pixel drift.
  it('burns the same field one-way as bidirectionally', () => {
    const luma = quadrantLuma(PX, PX);
    const bitmap = { luma, width: PX, height: PX, tone: 'threshold' as const };
    const base = {
      luma,
      width: PX,
      height: PX,
      sceneBounds: SCENE,
      ditherAlgorithm: 'threshold' as const,
    };

    const oneWay = scoreRasterBurn(
      compileRasterFixture({ ...base, bidirectional: false }),
      bitmap,
      FINE_CELLS,
    );
    const snaked = scoreRasterBurn(
      compileRasterFixture({ ...base, bidirectional: true }),
      bitmap,
      FINE_CELLS,
    );

    expect(oneWay.meanAbsoluteError).toBeLessThan(1e-9);
    expect(snaked.meanAbsoluteError).toBeLessThan(1e-9);
  });
});
