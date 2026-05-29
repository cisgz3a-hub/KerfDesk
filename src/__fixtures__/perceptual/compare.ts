// Perceptual test harness — binary-mask comparator.
//
// Given a predicted ink mask (rasterized pipeline output) and a ground-truth
// ink mask (the answer the source image demands), report how well they
// overlap. The headline metric is IoU (intersection-over-union / Jaccard):
// the fraction of inked-by-either pixels that both agree on. Unlike pixel
// accuracy, IoU does not flatter a mostly-white image — a trace that inks
// nothing scores 0, not 95%.
//
// precision = "of the pixels we inked, how many should be ink?" (penalises
// the classic outline-tracer artefact of a doubled/too-thick contour).
// recall = "of the pixels that should be ink, how many did we ink?"
// (penalises dropped strokes). f1 is their harmonic mean.
//
// Test-only helper: lives under src/__fixtures__ (boundary- and
// coverage-exempt per eslint.config.mjs). Pure and deterministic.

import type { Mask } from './rasterize';

export type MaskMetrics = {
  readonly truePositive: number; // inked by both
  readonly falsePositive: number; // inked by prediction only (spurious ink)
  readonly falseNegative: number; // inked by truth only (missed ink)
  readonly trueNegative: number; // background in both
  readonly iou: number; // TP / (TP + FP + FN)
  readonly precision: number; // TP / (TP + FP)
  readonly recall: number; // TP / (TP + FN)
  readonly f1: number; // harmonic mean of precision and recall
  readonly agreement: number; // (TP + TN) / total pixels
};

export function compareMasks(predicted: Mask, truth: Mask): MaskMetrics {
  if (predicted.width !== truth.width || predicted.height !== truth.height) {
    throw new Error(
      `mask size mismatch: ${predicted.width}×${predicted.height} vs ${truth.width}×${truth.height}`,
    );
  }
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  const n = predicted.data.length;
  for (let i = 0; i < n; i += 1) {
    const p = predicted.data[i] ?? 0;
    const t = truth.data[i] ?? 0;
    if (p === 1 && t === 1) truePositive += 1;
    else if (p === 1) falsePositive += 1;
    else if (t === 1) falseNegative += 1;
    else trueNegative += 1;
  }
  const precision = ratio(truePositive, truePositive + falsePositive);
  const recall = ratio(truePositive, truePositive + falseNegative);
  const f1Denominator = precision + recall;
  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    iou: ratio(truePositive, truePositive + falsePositive + falseNegative),
    precision,
    recall,
    f1: f1Denominator === 0 ? 0 : (2 * precision * recall) / f1Denominator,
    agreement: ratio(truePositive + trueNegative, n),
  };
}

// A count ratio that treats 0/0 as a perfect 1: an empty prediction against
// an empty truth agrees completely, so a metric should reward it rather than
// return NaN. Every numerator here is a subset of its denominator, so the
// result is always in [0, 1].
function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return numerator / denominator;
}
