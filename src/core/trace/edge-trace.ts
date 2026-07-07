// Edge Detection trace: local-contrast ink mask → the own contour finisher.
//
// Two engines preceded this one. The Canny-chain engine (ADR-059)
// manufactured hooked serif tips and wandering contours in its geometry
// synthesis; ADR-115 replaced that stage with potrace geometry, whose apex
// snapping in turn stabbed spikes past small-letter feet and drew counters
// as pointed leaves (maintainer report, 2026-07-07). The geometry stage is
// now the SAME in-house contour finisher the filled-contours lane uses
// (contour-trace.ts: mid-crack boundary walk → corner-safe smoothing →
// straight-run flattening → bounded spline), so both lanes share one
// quality bar and the tree carries no potrace-derived code. What stays from
// ADR-115 is the detection half: the LOCAL-contrast ink mask (mkbitmap's
// design — catches the faint detail a global threshold drops, see
// local-contrast-mask.ts). Output remains closed contours only, matching
// LightBurn's trace semantics.
//
// The Canny-era option fields stay as the public knobs so the dialog,
// presets, and merge logic are untouched; the engine derives its two mask
// parameters from them (see the derivation constants below).

import type { ColoredPath } from '../scene';
import { contourPolylinesFromMask } from './contour-trace';
import { localContrastInkBitmap } from './local-contrast-mask';
import { impulseNoiseRatio, IMPULSE_NOISE_MIN_RATIO, medianFilter } from './preprocess';
import type { RawImageData, TraceOptions } from './trace-image';

const EDGE_COLOR = '#000000';
const DEFAULT_EDGE_MIN_LENGTH_PX = 3;
// Same base simplification epsilon as the contour lane (see contour-trace).
const EDGE_SIMPLIFY_EPSILON_PX = 0.45;

// Slider → mask-parameter derivations. The dialog's Edge sliders land in
// TraceOptions as Canny-era fields (src/ui/trace/trace-options.ts):
// Sensitivity → edgeLow/HighThresholdRatio, Detail → edgeBlurSigma,
// Minimum line → edgeMinLengthPx.
//
// delta (how much darker than the neighbourhood counts as ink) derives from
// the LOW threshold ratio: the app default (sensitivity 50 → low 0.074)
// must land on the prototype-approved delta 6, hence the 6/0.074 scale.
// Higher sensitivity → lower ratio → smaller delta → fainter ink caught,
// preserving the slider's direction.
const DELTA_PER_LOW_THRESHOLD_RATIO = 6 / 0.074;
const DEFAULT_LOW_THRESHOLD_RATIO = 0.074;
const DELTA_MIN = 2;
const DELTA_MAX = 12;
// radius (the neighbourhood the local mean is taken over) derives from the
// blur sigma: the app default (detail 68 → sigma 1.2) must land on the
// prototype-approved radius 12, hence the ×10 scale. More Detail → smaller
// sigma → smaller neighbourhood → finer local adaptation.
const RADIUS_PER_BLUR_SIGMA = 10;
const DEFAULT_BLUR_SIGMA = 1.2;
const RADIUS_MIN_PX = 4;
const RADIUS_MAX_PX = 32;

export function traceImageToEdgePaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  const source = medianForEdges(image, options.edgeMedianFilter);
  const bitmap = localContrastInkBitmap(source, {
    radiusPx: maskRadiusPx(options),
    delta: maskDelta(options),
  });
  const polylines = contourPolylinesFromMask(
    { width: bitmap.width, height: bitmap.height, ink: bitmap.data },
    {
      // The Edge preset's "minimum line" knob maps onto the finisher's
      // speckle gate: loops below this area (px²) are dropped — the same
      // numeric mapping the previous geometry stage used for its
      // area-based suppression.
      minAreaPx: Math.max(2, Math.round(options.edgeMinLengthPx ?? DEFAULT_EDGE_MIN_LENGTH_PX)),
      epsilonPx: EDGE_SIMPLIFY_EPSILON_PX * Math.max(0.1, options.lineTolerance ?? 1),
      // Same Smoothness → flatten-strength ramp as the contour lane.
      flattenStrength: Math.max(0, 6 * (options.smoothness ?? 1) - 5),
    },
  );
  return polylines.length === 0 ? [] : [{ color: EDGE_COLOR, polylines }];
}

function maskDelta(options: TraceOptions): number {
  const low = options.edgeLowThresholdRatio ?? DEFAULT_LOW_THRESHOLD_RATIO;
  return clamp(Math.round(low * DELTA_PER_LOW_THRESHOLD_RATIO), DELTA_MIN, DELTA_MAX);
}

function maskRadiusPx(options: TraceOptions): number {
  const sigma = options.edgeBlurSigma ?? DEFAULT_BLUR_SIGMA;
  return clamp(Math.round(sigma * RADIUS_PER_BLUR_SIGMA), RADIUS_MIN_PX, RADIUS_MAX_PX);
}

// Median pre-filtering: a 3×3 median protects noisy photos but DESTROYS
// clean small features — 4-6 px letters trace as melted blobs (the
// LANGEBAAN defect). Default (undefined) is therefore AUTO: apply the
// median only when the image actually contains impulse noise (see
// hasImpulseNoise in preprocess.ts, which owns the shared detector and its
// constants). An explicit true/false still forces the choice.
//
// The auto branch reuses the median it already computed rather than calling
// hasImpulseNoise (which would filter a second time).
function medianForEdges(image: RawImageData, edgeMedianFilter: boolean | undefined): RawImageData {
  if (edgeMedianFilter === false) return image;
  const filtered = medianFilter(image);
  if (edgeMedianFilter === true) return filtered;
  return impulseNoiseRatio(image, filtered) >= IMPULSE_NOISE_MIN_RATIO ? filtered : image;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
