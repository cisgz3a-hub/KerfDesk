import {
  THIN_STROKE_UPSCALE_FACTOR,
  computeUpscaleFactor,
  shouldAutoUpscale,
  shouldUpscaleSmallSource,
} from './auto-upscale';
import { shouldUseSketchTrace } from './auto-sketch-trace';
import { contourDetailProfile, type ContourDetailProfile } from './contour-detail-detector';
import { isBinaryContourPreset } from './contour-trace';
import type { RawImageData, TraceOptions } from './trace-image';
import { fitsTraceWorkingPixelBudget } from './trace-work-budget';

const DENSE_COLOR_TRANSITION_DENSITY = 0.025;
const DENSE_COLOR_DOWNSCALE_TRIGGER_PIXELS = 1_500_000;
const DENSE_COLOR_TARGET_PIXELS = 1_250_000;

export type TraceScalePlan =
  | { readonly kind: 'native' }
  | { readonly kind: 'upscale'; readonly factor: number }
  | {
      readonly kind: 'downscale';
      readonly width: number;
      readonly height: number;
      readonly coordinateScale: number;
    };

/**
 * Returns the supersample factor selected for a trace, or 1 for native size.
 * Small/thin-source triggers retain their historical factors. The contour
 * quality trigger adds 2x only for coherent narrow mask detail. Upscaling
 * remains bilinear: prior bicubic and monotone-cubic trials regressed the
 * corner-heavy small-glyph fixtures even when their curve fixtures improved.
 */
export function traceUpscaleFactor(image: RawImageData, options: TraceOptions): number {
  const plan = traceScalePlan(image, options);
  return plan.kind === 'upscale' ? plan.factor : 1;
}

/**
 * Select the raster resolution used by the tracer. Sparse thin details retain
 * the feature-aware quality supersample. Dense color pictures stay native at
 * ordinary sizes and use a bounded working grid above 1.5 MP; their vectors
 * are restored to source coordinates after tracing.
 */
export function traceScalePlan(image: RawImageData, options: TraceOptions): TraceScalePlan {
  const thinStroke = options.autoUpscaleSmallSources === true && shouldAutoUpscale(image);
  const smallSmooth = options.upscaleSmallSmoothSources === true && shouldUpscaleSmallSource(image);
  const thinFactor = thinStroke ? THIN_STROKE_UPSCALE_FACTOR : 1;
  const smallFactor = smallSmooth ? computeUpscaleFactor(image) : 1;
  const profile = contourQualityProfile(image, options);
  const denseColor = isDenseColorProfile(image, options, profile);
  if (denseColor) {
    const downscale = denseColorDownscalePlan(image);
    if (downscale !== null) return downscale;
  }
  const detailFactor = shouldUseContourQualityScale(image, options, profile, denseColor)
    ? THIN_STROKE_UPSCALE_FACTOR
    : 1;
  let factor = Math.max(thinFactor, smallFactor, detailFactor);

  while (factor > 1 && !fitsTraceWorkingPixelBudget(image, factor, options)) factor -= 1;
  return factor > 1 ? { kind: 'upscale', factor } : { kind: 'native' };
}

function contourQualityProfile(
  image: RawImageData,
  options: TraceOptions,
): ContourDetailProfile | null {
  if (options.supersampleContour !== true) return null;
  if (!isBinaryContourPreset(options) && options.traceMode !== 'edge') return null;
  return contourDetailProfile(image, options);
}

function shouldUseContourQualityScale(
  image: RawImageData,
  options: TraceOptions,
  profile: ContourDetailProfile | null,
  denseColor: boolean,
): boolean {
  if (profile === null || denseColor) return false;
  if (!fitsTraceWorkingPixelBudget(image, THIN_STROKE_UPSCALE_FACTOR, options)) return false;
  return profile.hasThinDetail;
}

function isDenseColorProfile(
  image: RawImageData,
  options: TraceOptions,
  profile: ContourDetailProfile | null,
): boolean {
  return (
    profile !== null &&
    profile.transitionDensity >= DENSE_COLOR_TRANSITION_DENSITY &&
    isBinaryContourPreset(options) &&
    shouldUseSketchTrace(image, options)
  );
}

function denseColorDownscalePlan(image: RawImageData): TraceScalePlan | null {
  const sourcePixels = image.width * image.height;
  if (sourcePixels <= DENSE_COLOR_DOWNSCALE_TRIGGER_PIXELS) return null;
  const requestedScale = Math.sqrt(sourcePixels / DENSE_COLOR_TARGET_PIXELS);
  const width = Math.max(1, Math.round(image.width / requestedScale));
  const coordinateScale = image.width / width;
  return {
    kind: 'downscale',
    width,
    height: Math.max(1, Math.round(image.height / coordinateScale)),
    coordinateScale,
  };
}
