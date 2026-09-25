import { shouldUseSketchTrace } from './auto-sketch-trace';
import { upscaleBy } from './auto-upscale';
import {
  contourTraceInputMatches,
  prepareContourTraceInput,
  type ContourTraceInput,
} from './contour-input';
import { restoreEnlargedContourSupport } from './contour-support';
import type { EdgeTraceInput } from './edge-input';
import { autoMedianFilter } from './preprocess';
import { shouldTraceAlphaMask } from './trace-alpha';
import {
  applyImageAdjustments,
  isValidRawImageData,
  type ContourMedianStage,
  type RawImageData,
  type TraceOptions,
} from './trace-image';

type UpscaledTraceInput = {
  readonly image: RawImageData;
  readonly options: TraceOptions;
  readonly contourInput: ContourTraceInput | undefined;
};

/** Prepare one enlarged execution without repeating accepted source cleanup. */
export function prepareUpscaledTraceInput(
  image: RawImageData,
  options: TraceOptions,
  factor: number,
  edgeInput?: EdgeTraceInput,
  contourInput?: ContourTraceInput,
): UpscaledTraceInput {
  // AUTO repairs source-grid impulses once; a forced median keeps its
  // working-grid order. Bilinear sampling still supplies the measured edges.
  const reuseCleanedEdge = edgeInput !== undefined && options.edgeMedianFilter !== true;
  const luma = reuseCleanedEdge ? undefined : sourceGridMedian(image, options, contourInput);
  const scaledOptions: TraceOptions = {
    ...options,
    pixelScale: factor,
    ...(reuseCleanedEdge ? { edgeMedianFilter: false } : {}),
    ...(luma?.options ?? {}),
  };
  const enlarged = upscaleBy(reuseCleanedEdge ? edgeInput.source : (luma?.source ?? image), factor);
  const preparedInput =
    contourInput === undefined ? undefined : prepareContourTraceInput(enlarged, scaledOptions);
  // Gray hairlines can brighten past the cut; Otsu can also change its cut.
  // Restore admitted detail locally without losing other supersampled edges.
  return {
    image: enlarged,
    options: scaledOptions,
    contourInput:
      contourInput !== undefined && preparedInput !== undefined
        ? restoreEnlargedContourSupport(contourInput, preparedInput, factor)
        : preparedInput,
  };
}

// The automatic median judges noise in pixels of the grid it runs on: the
// 3x3 window, the two-link support search and the frame fraction. Bilinear
// enlargement turns a one-source-pixel speck into a 2x2 or 3x3 blob whose
// pixels support each other, so on the working grid the same speck is no
// longer isolated and survives. The luma lanes therefore run it once at
// source resolution (mkbitmap's filter-before-scale order) and enlarge the
// cleaned pixels; the working grid skips it (ADR-411). Repaired pixels already
// carry the tone adjustments the median ran after, so those are cleared;
// with nothing repaired the source and its adjustments pass on unchanged.
function sourceGridMedian(
  image: RawImageData,
  options: TraceOptions,
  contourInput: ContourTraceInput | undefined,
): ReturnType<typeof medianCleanedSource> | undefined {
  const median = sourceMedianStage(image, options, contourInput);
  return median === undefined ? undefined : medianCleanedSource(image, median);
}

/** The source a later grid should resample once `median` has run on it, and
 * the options that stop that grid repeating the median or the tone chain. */
export function medianCleanedSource(
  image: RawImageData,
  median: ContourMedianStage,
): { readonly source: RawImageData; readonly options: Partial<TraceOptions> } {
  return median.cleaned === median.adjusted
    ? { source: image, options: { medianFilter: false } }
    : { source: median.cleaned, options: { ...NEUTRAL_TONE, medianFilter: false } };
}

const NEUTRAL_TONE: Partial<TraceOptions> = { brightness: 0, contrast: 0, gamma: 1, invert: false };

/** The source-grid median stage of a luma lane. The native preparation already
 * ran it, so reuse that; otherwise mirror prepareTraceForContour's branch
 * choice (alpha masks and the local-contrast sketch lanes skip the median). */
export function sourceMedianStage(
  image: RawImageData,
  options: TraceOptions,
  contourInput?: ContourTraceInput,
): ContourMedianStage | undefined {
  if (options.medianFilter !== 'auto' || options.traceMode === 'edge') return undefined;
  if (contourInput !== undefined && contourTraceInputMatches(contourInput, image, options)) {
    return contourInput.median;
  }
  if (!isValidRawImageData(image) || shouldTraceAlphaMask(image, options)) return undefined;
  if (options.faintLineRecovery !== true && shouldUseSketchTrace(image, options)) return undefined;
  const adjusted = applyImageAdjustments(image, options);
  return { adjusted, cleaned: autoMedianFilter(adjusted) };
}
