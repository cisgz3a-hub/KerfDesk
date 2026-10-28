// The automatic cut of the luma lanes: Otsu's method and the plateau
// mid-level that two-plateau art cuts at (ADR-402 Amendment 1).
//
// Algorithm reference: N. Otsu, "A Threshold Selection Method from
// Gray-Level Histograms", IEEE Trans. Sys. Man. Cyber. 9 (1979). Public-domain
// math; we implement from the paper. Separated from preprocess.ts, which
// holds the median and despeckle stages, by size.
//
// Pure-core compliant: no clock, no random, no I/O.

import { lumaAt } from './preprocess';
import type { RawImageData } from './trace-image';
import type { TraceOptions } from './trace-option-types';

// Otsu's method: returns the luma cutoff that maximises the
// between-class variance of the source's histogram. For bimodal
// inputs (a clear foreground + background) the result is the optimal
// binary threshold; for unimodal inputs it picks a sensible boundary
// that minimises misclassification. A single global cut cannot follow
// uneven lighting; background-flatten.ts handles that case before this
// runs (see otsuBinarization).
//
// Every cut inside an empty stretch of the histogram splits the image the
// same way and scores the same, so a tied maximum is resolved to the middle
// of that stretch (a clean black-on-white image cuts at 128, not 1).
//
// Implementation follows the cumulative-sum form (linear in pixel
// count + 256 histogram passes). Returns a value in [0, 255].
export function otsuThreshold(image: RawImageData): number {
  return otsuSeparation(image).threshold;
}

/** The cut the automatic threshold applies for a trace with these options
 *  (see automaticCutOf). */
export function automaticThreshold(image: RawImageData, options: AutomaticCutLane = {}): number {
  return automaticCutOf(otsuSeparation(image), options);
}

/** What the automatic cut reads from a trace's options: the lane, the grid's
 *  supersampling, and the source grid's two-plateau verdict when this grid
 *  is its enlargement. */
export type AutomaticCutLane = Pick<TraceOptions, 'traceMode' | 'sourcePlateauCut' | 'pixelScale'>;

/** Whether this lane's automatic cut can be the plateau mid-level (ADR-402
 *  Amendment 1). The mid-level puts outline edges where an anti-aliased or
 *  blurred edge has 50% coverage and keeps narrow counters open. Centerline,
 *  and Line + fill, which binarises as Centerline does (ADR-454), read a
 *  stroke's middle line rather than its edges; Otsu's heavier mask keeps
 *  their thin anti-aliased strokes joined, so they keep it. */
export function cutsAtPlateauMidLevel(options: Pick<TraceOptions, 'traceMode'>): boolean {
  return options.traceMode !== 'centerline' && options.traceMode !== 'hybrid';
}

/** Whether the automatic cut of `separation` is its plateau mid-level: a
 *  filled-outline lane on two-plateau art. An enlarged grid follows the
 *  source grid's verdict (TraceOptions.sourcePlateauCut): bilinear grey
 *  between two-level pixels is interpolation, not coverage evidence. */
export function usesPlateauCut(separation: OtsuSeparation, options: AutomaticCutLane): boolean {
  return cutsAtPlateauMidLevel(options) && (options.sourcePlateauCut ?? separation.twoPlateau);
}

/** The automatic cut: the plateau mid-level where usesPlateauCut, Otsu's cut
 *  otherwise. On a supersampled grid a tie keeps Otsu's lowest cut: there a
 *  gap lies between interpolated levels, and its middle is the bilinear
 *  saddle value between two-level pixels, where a 1 px diagonal line pinches
 *  (an attached hairline traced by Smooth: recall 1.000 at cuts 113-120 and
 *  135-150, 0.475 at 127-129). */
export function automaticCutOf(separation: OtsuSeparation, options: AutomaticCutLane): number {
  if (usesPlateauCut(separation, options)) return separation.midLevel;
  return (options.pixelScale ?? 1) > 1 ? separation.lowestThreshold : separation.threshold;
}

export type OtsuSeparation = {
  /** Cutoff in thresholdToMonochrome's convention: luma < threshold is ink.
   *  A tied stretch resolves to its middle. */
  readonly threshold: number;
  /** The lowest cut of that tied stretch (Otsu's first maximum). */
  readonly lowestThreshold: number;
  /** Otsu's separability η = σ²_between / σ²_total at the chosen cut, in
   *  [0, 1]; 0 for a single-valued image. Near 1 means two tight, well
   *  separated populations; a smooth ramp split in two scores about 0.75. */
  readonly separability: number;
  /** Mean luma above the cut minus mean luma below it. */
  readonly contrast: number;
  /** The mid-level between the ink and paper plateaus read from Otsu's
   *  split, same convention: where an anti-aliased or blurred edge has 50%
   *  coverage. `threshold` when the plateaus are closer than an ink/paper
   *  pair. */
  readonly midLevel: number;
  /** The histogram is two-plateau art: an ink and a paper level with only
   *  edge pixels between them, and some of those (real grey coverage). */
  readonly twoPlateau: boolean;
};

/** Otsu's cut plus the goodness measures defined by Otsu (1979), computed from
 *  one histogram pass. The threshold is identical to otsuThreshold. */
export function otsuSeparation(image: RawImageData): OtsuSeparation {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const luma = lumaAt(image.data, i);
    hist[luma] = (hist[luma] ?? 0) + 1;
    total += 1;
  }
  if (total === 0) {
    const empty = { threshold: 128, lowestThreshold: 128, separability: 0, contrast: 0 };
    return { ...empty, midLevel: 128, twoPlateau: false };
  }
  return otsuFromHistogram(hist, total);
}

function otsuFromHistogram(hist: Uint32Array, total: number): OtsuSeparation {
  let sumTotal = 0;
  for (let t = 0; t < 256; t += 1) sumTotal += t * (hist[t] ?? 0);
  const best = otsuMaximum(hist, total, sumTotal);
  // The middle of the tied stretch is the largest luma still classified as
  // ink. thresholdToMonochrome uses `luma >= cutoff` to mean "background";
  // we want pixels with luma <= it to be ink and pixels above it to be
  // background. The cutoff that satisfies that is one more. Clamp at 255
  // just in case (degenerate inputs where everything is at 255 already).
  const threshold = Math.min(255, Math.floor((best.first + best.last) / 2) + 1);
  const spread = totalScatter(hist, sumTotal / total);
  // varBetween is wB·wF·Δ² in counts; σ²_between/σ²_total = it / (N · scatter).
  const separability = spread === 0 ? 0 : Math.min(1, best.score / (total * spread));
  const plateaus = (best.score === 0 ? null : plateauMidLevel(hist, total, threshold)) ?? {
    midLevel: threshold,
    twoPlateau: false,
  };
  return {
    threshold,
    lowestThreshold: Math.min(255, best.first + 1),
    separability,
    contrast: best.contrast,
    ...plateaus,
  };
}

// The maximum between-class score over all cuts: the first cut reaching it,
// the last of the contiguous run of cuts tying it, and its class contrast.
function otsuMaximum(
  hist: Uint32Array,
  total: number,
  sumTotal: number,
): {
  readonly score: number;
  readonly first: number;
  readonly last: number;
  readonly contrast: number;
} {
  let sumB = 0;
  let wB = 0;
  let best = { score: 0, first: 0, last: 0, contrast: 0 };
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sumTotal - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > best.score) {
      best = { score: varBetween, first: t, last: t, contrast: mF - mB };
    } else if (varBetween === best.score && best.last === t - 1) {
      // An empty bin leaves both classes, so the score, exactly unchanged.
      best = { ...best, last: t };
    }
  }
  return best;
}

// Two-plateau detection for the automatic cut (ADR-402 Amendment 1). Otsu
// balances the two classes' variances, so where ink is sparse and its edges
// are wide (small text that is slightly blurred or enlarged from a low
// resolution) the edge pixels pull the cut deep into the paper side: strokes
// thicken and letter counters close (quality audit Q5-P2-1: cut 180 against
// a 132 mid-level). An anti-aliased or symmetrically blurred step has 50%
// coverage at the mid-level between its two plateaus whatever the blur width
// (the principle ADR-533 applies to edge crossings), so art made of an ink
// and a paper level is cut there.
//
// The plateaus are a low quantile of Otsu's dark class and the mirrored high
// quantile of its light class: robust to noise and to the edge pixels, and
// still the ink level on blurred strokes whose cores are the only pixels that
// reach it. Art means the pixels strictly inside the middle half between the
// plateaus are a small share of the frame (edges only); a photograph spreads
// its tones across that range and keeps Otsu's cut. Measured: 1.3-16% on
// clean, blurred, low-resolution, noisy and JPEG text and logos; 41% on the
// astronaut photo. A two-level image has none: its edges carry no coverage
// to place, and on an enlarged grid the mid-level would sit exactly on the
// bilinear saddles between diagonal pixels and pinch 1 px lines, so it keeps
// Otsu's cut (whose tie already falls in the middle of its gap).
const PLATEAU_QUANTILE = 0.02;
const MAX_TRANSITION_SHARE = 0.25;
const MIN_TRANSITION_SHARE = 0.005;
// Plateaus closer than this are not an ink/paper pair.
const MIN_PLATEAU_SPAN = 32;

function plateauMidLevel(
  hist: Uint32Array,
  total: number,
  otsuCut: number,
): { readonly midLevel: number; readonly twoPlateau: boolean } | null {
  const ink = classQuantile(hist, 0, otsuCut - 1, PLATEAU_QUANTILE);
  const paper = classQuantile(hist, otsuCut, 255, 1 - PLATEAU_QUANTILE);
  if (ink === null || paper === null || paper - ink < MIN_PLATEAU_SPAN) return null;
  const quarter = (paper - ink) / 4;
  let between = 0;
  for (let luma = 0; luma < 256; luma += 1) {
    if (luma > ink + quarter && luma < paper - quarter) between += hist[luma] ?? 0;
  }
  return {
    // Pixels darker than the mid-level are ink; at an exact .5 the level
    // itself is ink (a 0/255 image's mid-level is 128).
    midLevel: Math.ceil((ink + paper) / 2),
    twoPlateau: between >= MIN_TRANSITION_SHARE * total && between <= MAX_TRANSITION_SHARE * total,
  };
}

// The luma at quantile q of the histogram's [lo, hi] range; null when the
// range is empty.
function classQuantile(hist: Uint32Array, lo: number, hi: number, q: number): number | null {
  let count = 0;
  for (let luma = lo; luma <= hi; luma += 1) count += hist[luma] ?? 0;
  if (count === 0) return null;
  const rank = Math.max(1, Math.ceil(q * count));
  let seen = 0;
  for (let luma = lo; luma <= hi; luma += 1) {
    seen += hist[luma] ?? 0;
    if (seen >= rank) return luma;
  }
  return hi;
}

// Σ count·(luma − mean)², the histogram's total scatter.
function totalScatter(hist: Uint32Array, mean: number): number {
  let scatter = 0;
  for (let t = 0; t < 256; t += 1) scatter += (hist[t] ?? 0) * (t - mean) * (t - mean);
  return scatter;
}
