// Perceptual test harness — density-field comparator.
//
// compare.ts scores two BINARY masks with IoU. That metric is wrong here:
// IoU asks "did we ink the same pixels?", and a dithered engrave deliberately
// does not ink the same pixels as its source — it inks a scattering of dots
// whose local mean matches the source's tone. So this comparator scores two
// CONTINUOUS density fields instead, and reports two numbers that fail in
// different ways on purpose:
//
//   meanAbsoluteError  tone error. Catches "burned too dark / too light",
//                      power-modulation collapse (a gradient emitted flat),
//                      dropped scan rows, an image that is not burned at all.
//                      Blind to a field that is displaced but otherwise
//                      correct, if the artwork is roughly uniform.
//
//   correlation        structure error (Pearson r over cells). Catches
//                      inversion (r goes negative), mirroring, rotation
//                      landing in the wrong place, and translation — all of
//                      which can leave the mean error nearly untouched.
//                      Blind to a uniform scale or offset of the tone curve,
//                      which is precisely what meanAbsoluteError catches.
//
// Neither alone is sufficient; assert on both. Read them at cell scale — see
// image-density-truth.ts on why per-pixel equality is not the question.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import type { DensityField } from './gcode-burn-density';

export type DensityMetrics = {
  readonly cells: number;
  readonly meanAbsoluteError: number;
  readonly maxAbsoluteError: number;
  readonly predictedMean: number;
  readonly truthMean: number;
  // Pearson r over cells, in [-1, 1]. Zero when either field is perfectly
  // flat: correlation is undefined there, and reporting 0 rather than NaN
  // makes a `toBeGreaterThan` assertion fail in the safe direction instead
  // of silently comparing against NaN.
  readonly correlation: number;
};

export function compareDensityFields(predicted: DensityField, truth: DensityField): DensityMetrics {
  if (predicted.cellsX !== truth.cellsX || predicted.cellsY !== truth.cellsY) {
    throw new Error(
      `density grid mismatch: ${predicted.cellsX}×${predicted.cellsY} vs ${truth.cellsX}×${truth.cellsY}`,
    );
  }
  const n = predicted.data.length;
  if (n === 0) throw new Error('density grid mismatch: empty grid');
  let absoluteErrorSum = 0;
  let maxAbsoluteError = 0;
  let predictedSum = 0;
  let truthSum = 0;
  for (let i = 0; i < n; i += 1) {
    const p = predicted.data[i] ?? 0;
    const t = truth.data[i] ?? 0;
    const error = Math.abs(p - t);
    absoluteErrorSum += error;
    if (error > maxAbsoluteError) maxAbsoluteError = error;
    predictedSum += p;
    truthSum += t;
  }
  const predictedMean = predictedSum / n;
  const truthMean = truthSum / n;
  return {
    cells: n,
    meanAbsoluteError: absoluteErrorSum / n,
    maxAbsoluteError,
    predictedMean,
    truthMean,
    correlation: pearson(predicted, truth, predictedMean, truthMean),
  };
}

function pearson(
  predicted: DensityField,
  truth: DensityField,
  predictedMean: number,
  truthMean: number,
): number {
  let covariance = 0;
  let predictedVariance = 0;
  let truthVariance = 0;
  for (let i = 0; i < predicted.data.length; i += 1) {
    const dp = (predicted.data[i] ?? 0) - predictedMean;
    const dt = (truth.data[i] ?? 0) - truthMean;
    covariance += dp * dt;
    predictedVariance += dp * dp;
    truthVariance += dt * dt;
  }
  const denominator = Math.sqrt(predictedVariance * truthVariance);
  return denominator === 0 ? 0 : covariance / denominator;
}
