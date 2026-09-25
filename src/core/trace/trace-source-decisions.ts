// Whole-source binarisation decisions, frozen for derived regions (ADR-410).
//
// Two luma-lane decisions are made from the pixels a trace is handed, not
// from the settings: Otsu's cut (Sharp, Smooth, Centerline, and any preset
// with useOtsuThreshold) reads the histogram, and Line Art's auto-sketch
// trigger counts coloured pixels against a floor. Region Enhance traces a
// crop — supersampled to four times the pixels — so both can come out
// differently from the full pass it patches, and the patch then binarises
// differently from its surroundings. Resolving them once on the full source
// and carrying them in the derived options makes every pass cut the same way.
//
// Separate from trace-alpha.ts (which resolves the alpha verdict the same
// way) because these decisions need the trace-image preprocessing chain, and
// trace-image imports trace-alpha.

import { shouldUseSketchTrace, sourceHasAutoSketchColour } from './auto-sketch-trace';
import { otsuThreshold } from './preprocess';
import { invertImage } from './raster-prep';
import { resolveTraceSourceOptions, shouldTraceAlphaMask } from './trace-alpha';
import {
  applyImageAdjustments,
  applyMedian,
  type RawImageData,
  type TraceOptions,
} from './trace-image';

/** resolveTraceSourceOptions plus the full source's auto-sketch verdict and
 * Otsu cut, so a crop or resample of `image` binarises as `image` does.
 * Idempotent: already-resolved options are returned unchanged. */
export function resolveFrozenTraceSourceOptions(
  image: RawImageData,
  requested: TraceOptions,
): TraceOptions {
  const options = resolveTraceSourceOptions(image, requested);
  // Photo shading owns its tone model; an alpha mask decides ink without luma.
  if (options.photoDetail !== undefined || shouldTraceAlphaMask(image, options)) return options;
  return freezeOtsuThreshold(image, freezeAutoSketch(image, options));
}

function freezeAutoSketch(image: RawImageData, options: TraceOptions): TraceOptions {
  if (
    options.autoSketchTrace !== true ||
    options.sketchTrace === true ||
    options.sourceAutoSketch !== undefined
  ) {
    return options;
  }
  return {
    ...options,
    sourceAutoSketch: sourceHasAutoSketchColour(polarisedSource(image, options)),
  };
}

// The Otsu cut is only read on the brightness path: an explicit band or
// threshold wins over it, a sketch mask replaces it, and Edge Detection's
// local-contrast detector never reads it. It rides in its own field, not
// thresholdLuma, so the zero-paths retry that drops Otsu still drops it.
function freezeOtsuThreshold(image: RawImageData, options: TraceOptions): TraceOptions {
  if (
    options.useOtsuThreshold !== true ||
    options.sourceOtsuThreshold !== undefined ||
    options.cutoffLuma !== undefined ||
    options.thresholdLuma !== undefined ||
    options.traceMode === 'edge' ||
    (options.faintLineRecovery !== true && shouldUseSketchTrace(image, options))
  ) {
    return options;
  }
  return { ...options, sourceOtsuThreshold: sourceOtsuThreshold(image, options) };
}

// traceImageToColoredPaths applies Invert before any policy reads the source
// (ADR-396): Edge gets the plain inversion, the luma lanes the whole tone
// chain. The auto-sketch count must see the image those lanes see.
function polarisedSource(image: RawImageData, options: TraceOptions): RawImageData {
  if (options.invert !== true) return image;
  return options.traceMode === 'edge' ? invertImage(image) : applyImageAdjustments(image, options);
}

/** The Otsu cut the native-grid luma lanes derive for this whole image, from
 * the same adjustments -> median -> histogram chain as the brightness path's
 * input. Where the histogram has a gap above the cut, every cut in the gap
 * splits this image identically and Otsu reports the lowest; the gap's middle
 * is returned instead, so the cut still separates ink from paper on a
 * supersampled crop whose interpolated edges fill the gap (a clean
 * black-on-white image cuts at 128, not 1). */
export function sourceOtsuThreshold(image: RawImageData, options: TraceOptions): number {
  const prepared = applyMedian(applyImageAdjustments(image, options), options.medianFilter);
  const cut = otsuThreshold(prepared);
  let nextLevel = 256;
  for (let i = 0; i < prepared.data.length; i += 4) {
    // The rounded BT.601 luma otsuThreshold bins by.
    const luma = Math.round(
      0.299 * (prepared.data[i] ?? 0) +
        0.587 * (prepared.data[i + 1] ?? 0) +
        0.114 * (prepared.data[i + 2] ?? 0),
    );
    if (luma >= cut && luma < nextLevel) nextLevel = luma;
  }
  return nextLevel > 255 ? cut : Math.floor((cut + nextLevel) / 2);
}
