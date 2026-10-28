// Whole-source binarisation decisions, frozen for derived regions (ADR-435).
//
// Three luma-lane decisions are made from the pixels a trace is handed, not
// from the settings: Otsu's cut (Sharp, Smooth, Centerline, and any preset
// with useOtsuThreshold) reads the histogram, Line Art's auto-sketch trigger
// counts coloured pixels against a floor, and Smooth's automatic median fires
// only when isolated impulses reach a fraction of the frame (ADR-436). Region
// Enhance traces a crop — supersampled to four times the pixels — so each can
// come out differently from the full pass it patches, and the patch then
// binarises differently from its surroundings. Resolving them once on the
// full source and carrying them in the derived options makes every pass cut
// the same way.
//
// Separate from trace-alpha.ts (which resolves the alpha verdict the same
// way) because these decisions need the trace-image preprocessing chain, and
// trace-image imports trace-alpha.

import { shouldUseSketchTrace, sourceHasAutoSketchColour } from './auto-sketch-trace';
import { applyMedian } from './apply-median';
import { otsuBinarization } from './background-flatten';
import { automaticThreshold } from './otsu-cut';
import { invertImage } from './raster-prep';
import { resolveTraceSourceOptions, shouldTraceAlphaMask } from './trace-alpha';
import { applyImageAdjustments, type RawImageData, type TraceOptions } from './trace-image';

/** resolveTraceSourceOptions plus the full source's auto-sketch verdict, Otsu
 * cut and automatic-median verdict, so a crop or resample of `image`
 * binarises as `image` does.
 * Idempotent: already-resolved options are returned unchanged. */
export function resolveFrozenTraceSourceOptions(
  image: RawImageData,
  requested: TraceOptions,
): TraceOptions {
  const options = resolveTraceSourceOptions(image, requested);
  // Photo shading owns its tone model; an alpha mask decides ink without luma.
  if (options.photoDetail !== undefined || shouldTraceAlphaMask(image, options)) return options;
  return freezeMedianDecisions(image, freezeAutoSketch(image, options));
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
// The automatic median's verdict (does this whole image carry enough
// isolated impulses to repair?) is read from the same median pass (ADR-436).
function freezeMedianDecisions(image: RawImageData, options: TraceOptions): TraceOptions {
  const otsu = readsOtsuCut(image, options) && options.sourceOtsuThreshold === undefined;
  const median = runsAutoMedian(image, options) && options.sourceAutoMedian === undefined;
  if (!otsu && !median) return options;
  const adjusted = applyImageAdjustments(image, options);
  const prepared = applyMedian(adjusted, options.medianFilter);
  return {
    ...options,
    ...(median ? { sourceAutoMedian: prepared !== adjusted } : {}),
    ...(otsu ? frozenOtsuCut(prepared, options) : {}),
  };
}

// A page whose uneven lighting the automatic cut flattens (ADR-402) has no
// single global cut to freeze: each pass levels its own grid instead.
// Otherwise the frozen cut is the one the full pass applies (ADR-435
// Amendment 1).
function frozenOtsuCut(
  prepared: RawImageData,
  options: TraceOptions,
): Pick<TraceOptions, 'sourceOtsuThreshold'> {
  const level = otsuBinarization(prepared, options);
  return level.flattened ? {} : { sourceOtsuThreshold: level.threshold };
}

function lumaLane(image: RawImageData, options: TraceOptions): boolean {
  return (
    options.traceMode !== 'edge' &&
    (options.faintLineRecovery === true || !shouldUseSketchTrace(image, options))
  );
}

function readsOtsuCut(image: RawImageData, options: TraceOptions): boolean {
  return (
    options.useOtsuThreshold === true &&
    options.cutoffLuma === undefined &&
    options.thresholdLuma === undefined &&
    lumaLane(image, options)
  );
}

function runsAutoMedian(image: RawImageData, options: TraceOptions): boolean {
  return options.medianFilter === 'auto' && lumaLane(image, options);
}

// traceImageToColoredPaths applies Invert before any policy reads the source
// (ADR-404): Edge gets the plain inversion, the luma lanes the whole tone
// chain. The auto-sketch count must see the image those lanes see.
function polarisedSource(image: RawImageData, options: TraceOptions): RawImageData {
  if (options.invert !== true) return image;
  return options.traceMode === 'edge' ? invertImage(image) : applyImageAdjustments(image, options);
}

/** The automatic cut the native-grid luma lanes derive for this whole image,
 * from the same adjustments -> median -> histogram chain as the brightness
 * path's input. Otsu resolves a gap above its cut to the gap's middle, and
 * two-plateau art cuts at its plateaus' mid-level, so the cut still separates
 * ink from paper on a supersampled crop whose interpolated edges fill the gap
 * (a clean black-on-white image cuts at 128, not 1). */
export function sourceOtsuThreshold(image: RawImageData, options: TraceOptions): number {
  return automaticThreshold(
    applyMedian(applyImageAdjustments(image, options), options.medianFilter),
    options,
  );
}
