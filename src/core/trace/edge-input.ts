import { clamp } from '../math';
import type { CrackSubPixelField } from './contour-boundary';
import {
  localContrastTraceData,
  type LocalContrastMaskOptions,
  type TraceBitmap,
} from './local-contrast-mask';
import { autoMedianFilter, medianFilter } from './preprocess';
import { invertImage } from './raster-prep';
import { shouldTraceAlphaMask } from './trace-alpha';
import { effectivePixelScale, type RawImageData, type TraceOptions } from './trace-image';

// The detector has two parameters (ADR-412). Both are carried by the
// Canny-era option fields so saved options keep their exact output:
//   delta  = round(edgeLowThresholdRatio x 6/0.074), an integer 2..12 luma levels;
//   radius = round(edgeBlurSigma x 10), an integer 4..32 source pixels.
// The dialog maps its Sensitivity and Detail stops onto these integers and
// back through the helpers below, so every stop it offers is one detector
// setting and no two stops share one.
const DELTA_PER_LOW_THRESHOLD_RATIO = 6 / 0.074;
const DEFAULT_LOW_THRESHOLD_RATIO = 0.074;
const RADIUS_PER_BLUR_SIGMA = 10;
const DEFAULT_BLUR_SIGMA = 1.2;
export const EDGE_CONTRAST_DELTA_MIN = 2;
export const EDGE_CONTRAST_DELTA_MAX = 12;
export const EDGE_MASK_RADIUS_MIN_PX = 4;
export const EDGE_MASK_RADIUS_MAX_PX = 32;

export type EdgeTraceInput = {
  readonly image: RawImageData;
  readonly source: RawImageData;
  readonly bitmap: TraceBitmap;
  readonly crackField: CrackSubPixelField;
  readonly maskOptions: LocalContrastMaskOptions;
  readonly medianFilter: boolean | undefined;
  readonly invert: boolean;
  readonly alphaMask: boolean;
};

/** Prepare noise cleanup, detector mask and measured boundary together. The
 * public dispatcher can reuse this native-grid work after the quality profile. */
export function prepareEdgeTraceInput(image: RawImageData, options: TraceOptions): EdgeTraceInput {
  // Trace alpha mask: the detector reads coverage (opaque = dark) instead of
  // colour, so art whose colour matches the paper still outlines, with the
  // anti-aliased alpha ramp as its measured boundary. Invert cannot change
  // which pixels are covered, so it stands down (as in the luma lanes).
  const alphaMask = shouldTraceAlphaMask(image, options);
  // The local-contrast detector marks pixels DARKER than their neighbourhood,
  // so Invert must reach it as luma: light artwork on a dark ground becomes
  // dark artwork on a light one, with the same measured boundary field.
  const invert = !alphaMask && options.invert === true;
  const source = alphaMask
    ? alphaCoverageImage(image)
    : edgeSource(invert ? invertImage(image) : image, options.edgeMedianFilter);
  const maskOptions = edgeMaskOptions(options);
  return {
    image,
    source,
    ...localContrastTraceData(source, maskOptions),
    maskOptions,
    medianFilter: options.edgeMedianFilter,
    invert,
    alphaMask,
  };
}

/** Reuse only for the same source object, grid and effective mask controls.
 * Geometry-only controls do not invalidate a detector mask. */
export function edgeTraceInputMatches(
  input: EdgeTraceInput,
  image: RawImageData,
  options: TraceOptions,
): boolean {
  const mask = edgeMaskOptions(options);
  const alphaMask = shouldTraceAlphaMask(image, options);
  return (
    input.image === image &&
    input.bitmap.width === image.width &&
    input.bitmap.height === image.height &&
    input.alphaMask === alphaMask &&
    input.medianFilter === options.edgeMedianFilter &&
    input.invert === (!alphaMask && options.invert === true) &&
    input.maskOptions.radiusPx === mask.radiusPx &&
    input.maskOptions.delta === mask.delta
  );
}

/** The detector's neighbourhood radius on this execution's grid, in pixels. */
export function edgeMaskRadiusPx(options: TraceOptions): number {
  return edgeMaskOptions(options).radiusPx;
}

/** How many luma levels darker than its neighbourhood a pixel must be. */
export function edgeContrastDelta(options: TraceOptions): number {
  const low = options.edgeLowThresholdRatio ?? DEFAULT_LOW_THRESHOLD_RATIO;
  return clamp(
    Math.round(low * DELTA_PER_LOW_THRESHOLD_RATIO),
    EDGE_CONTRAST_DELTA_MIN,
    EDGE_CONTRAST_DELTA_MAX,
  );
}

/** The stored ratio that reproduces `delta` exactly. */
export function edgeLowThresholdRatioForDelta(delta: number): number {
  const level = clamp(Math.round(delta), EDGE_CONTRAST_DELTA_MIN, EDGE_CONTRAST_DELTA_MAX);
  return level / DELTA_PER_LOW_THRESHOLD_RATIO;
}

/** The neighbourhood radius in SOURCE pixels (before any supersampling). */
export function edgeSourceRadiusPx(options: TraceOptions): number {
  const sigma = options.edgeBlurSigma ?? DEFAULT_BLUR_SIGMA;
  return clamp(
    Math.round(sigma * RADIUS_PER_BLUR_SIGMA),
    EDGE_MASK_RADIUS_MIN_PX,
    EDGE_MASK_RADIUS_MAX_PX,
  );
}

/** The stored blur sigma that reproduces `radiusPx` exactly. */
export function edgeBlurSigmaForRadius(radiusPx: number): number {
  const radius = clamp(Math.round(radiusPx), EDGE_MASK_RADIUS_MIN_PX, EDGE_MASK_RADIUS_MAX_PX);
  return radius / RADIUS_PER_BLUR_SIGMA;
}

function edgeMaskOptions(options: TraceOptions): LocalContrastMaskOptions {
  return {
    radiusPx: edgeSourceRadiusPx(options) * effectivePixelScale(options),
    delta: edgeContrastDelta(options),
  };
}

function edgeSource(image: RawImageData, median: boolean | undefined): RawImageData {
  if (median === false) return image;
  return median === true ? medianFilter(image) : autoMedianFilter(image);
}

// Coverage as opaque grey: luma = 255 - alpha. Authored alpha carries no
// impulse noise, so no median runs on it (the luma lanes' alpha mask skips
// the median too).
function alphaCoverageImage(image: RawImageData): RawImageData {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const luma = 255 - (image.data[i + 3] ?? 255);
    data[i] = luma;
    data[i + 1] = luma;
    data[i + 2] = luma;
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}
