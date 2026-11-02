// A portrait as it looks burned (ADR-685), through the shipping compiler.
//
// The astronaut's head at 10 lines/mm, each mark drawn as a round 1.6-cell
// dot (the 4040's spot over a 0.1 mm interval) and scored in L* against the
// photo by portrait-burn-view.ts. Three things are checked:
//   1. Auto tones clear the stray dots that a light background and skin
//      highlights scatter, without moving the face's overall tone or losing
//      its detail.
//   2. The material view's beam-spread model (core/raster/beam-spread.ts)
//      agrees with exact supersampled dots, so the dialog can show the
//      darkening before anything burns.
//   3. Blue Noise holds the face's detail at least as well as Jarvis, which
//      is why the material recipes choose it.

import { describe, expect, it } from 'vitest';
import { beamSpreadKernel, spreadRasterRows } from '../../core/raster/beam-spread';
import { lumaHistogram, portraitAutoTones } from '../../core/raster/portrait-auto-tones';
import { ciBudgetMs } from '../ci-budget';
import {
  exactDotReflectance,
  gaussianBlur,
  highlightSpeckle,
  lstar,
  PORTRAIT_EDGE,
  portraitBurn,
  portraitHeadLuma,
  scorePortrait,
  VIEW_SIGMA_CELLS,
} from './portrait-burn-view';

const SPOT_CELLS = 1.6;
const BUDGET_MS = ciBudgetMs(30_000, 90_000);

function modelReflectance(burn: Float64Array, subdivisions: number): Float64Array {
  const edge = PORTRAIT_EDGE;
  const kernel = beamSpreadKernel(SPOT_CELLS, SPOT_CELLS, subdivisions);
  if (kernel === null) throw new Error('expected a kernel');
  const out = new Float64Array(edge * edge);
  spreadRasterRows(
    edge,
    edge,
    1,
    kernel,
    (y) => burn.subarray(y * edge, (y + 1) * edge),
    (y, row) => {
      for (let x = 0; x < edge; x += 1) out[y * edge + x] = 1 - (row[x] ?? 0);
    },
  );
  return out;
}

describe('portrait burn — what the viewer sees', () => {
  it(
    'Auto tones clear highlight speckle and keep the face tone and detail',
    () => {
      const tones = portraitAutoTones(lumaHistogram(portraitHeadLuma()));
      if (tones === null) throw new Error('expected auto tones');
      for (const algorithm of ['blue-noise', 'jarvis'] as const) {
        const plainBurn = portraitBurn(algorithm);
        const autoBurn = portraitBurn(algorithm, tones);
        const plain = scorePortrait(exactDotReflectance(plainBurn, SPOT_CELLS));
        const auto = scorePortrait(exactDotReflectance(autoBurn, SPOT_CELLS));
        // Measured: 12.5% -> 3.6% (Blue Noise), 11.8% -> 1.9% (Jarvis).
        expect(highlightSpeckle(autoBurn)).toBeLessThan(highlightSpeckle(plainBurn) * 0.35);
        // Measured bias -0.4 -> -1.2 L* (Blue Noise), 2.1 -> 0.9 (Jarvis).
        expect(Math.abs(auto.bias)).toBeLessThan(2.5);
        // Measured detail 0.923 -> 0.921 (Blue Noise), 0.881 -> 0.902 (Jarvis).
        expect(auto.detail).toBeGreaterThan(plain.detail - 0.02);
      }
    },
    BUDGET_MS,
  );

  it(
    'the material view spreads dots as exact round spots do',
    () => {
      const edge = PORTRAIT_EDGE;
      for (const algorithm of ['blue-noise', 'jarvis'] as const) {
        const burn = portraitBurn(algorithm);
        const exact = gaussianBlur(exactDotReflectance(burn, SPOT_CELLS), edge, VIEW_SIGMA_CELLS);
        const model = gaussianBlur(modelReflectance(burn, 3), edge, VIEW_SIGMA_CELLS);
        let error = 0;
        for (let i = 0; i < exact.length; i += 1) {
          error += Math.abs(lstar(model[i] ?? 0) - lstar(exact[i] ?? 0));
        }
        // Measured: 0.50 L* (Blue Noise), 0.38 L* (Jarvis) at three sub-cells.
        expect(error / exact.length).toBeLessThan(1);
      }
    },
    BUDGET_MS,
  );

  it(
    'Blue Noise keeps at least as much facial detail as Jarvis',
    () => {
      const blue = scorePortrait(exactDotReflectance(portraitBurn('blue-noise'), SPOT_CELLS));
      const jarvis = scorePortrait(exactDotReflectance(portraitBurn('jarvis'), SPOT_CELLS));
      // Measured: detail 0.923 vs 0.881, error 2.2 vs 3.2 L*.
      expect(blue.detail).toBeGreaterThan(jarvis.detail);
      expect(blue.meanAbsoluteError).toBeLessThan(jarvis.meanAbsoluteError);
    },
    BUDGET_MS,
  );
});
