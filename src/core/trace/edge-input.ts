import { clamp } from '../math';
import type { CrackSubPixelField } from './contour-boundary';
import {
  localContrastTraceData,
  type LocalContrastMaskOptions,
  type TraceBitmap,
} from './local-contrast-mask';
import { autoMedianFilter, medianFilter } from './preprocess';
import { effectivePixelScale, type RawImageData, type TraceOptions } from './trace-image';

// The public Canny-era fields retain their existing local-mask mapping:
// sensitivity lowers delta, and more Detail narrows the local neighbourhood.
const DELTA_PER_LOW_THRESHOLD_RATIO = 6 / 0.074;
const DEFAULT_LOW_THRESHOLD_RATIO = 0.074;
const RADIUS_PER_BLUR_SIGMA = 10;
const DEFAULT_BLUR_SIGMA = 1.2;

export type EdgeTraceInput = {
  readonly image: RawImageData;
  readonly source: RawImageData;
  readonly bitmap: TraceBitmap;
  readonly crackField: CrackSubPixelField;
  readonly maskOptions: LocalContrastMaskOptions;
  readonly medianFilter: boolean | undefined;
};

/** Prepare noise cleanup, detector mask and measured boundary together. The
 * public dispatcher can reuse this native-grid work after the quality profile. */
export function prepareEdgeTraceInput(image: RawImageData, options: TraceOptions): EdgeTraceInput {
  const source = edgeSource(image, options.edgeMedianFilter);
  const maskOptions = edgeMaskOptions(options);
  return {
    image,
    source,
    ...localContrastTraceData(source, maskOptions),
    maskOptions,
    medianFilter: options.edgeMedianFilter,
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
  return (
    input.image === image &&
    input.bitmap.width === image.width &&
    input.bitmap.height === image.height &&
    input.medianFilter === options.edgeMedianFilter &&
    input.maskOptions.radiusPx === mask.radiusPx &&
    input.maskOptions.delta === mask.delta
  );
}

function edgeMaskOptions(options: TraceOptions): LocalContrastMaskOptions {
  const low = options.edgeLowThresholdRatio ?? DEFAULT_LOW_THRESHOLD_RATIO;
  const sigma = options.edgeBlurSigma ?? DEFAULT_BLUR_SIGMA;
  return {
    radiusPx:
      clamp(Math.round(sigma * RADIUS_PER_BLUR_SIGMA), 4, 32) * effectivePixelScale(options),
    delta: clamp(Math.round(low * DELTA_PER_LOW_THRESHOLD_RATIO), 2, 12),
  };
}

function edgeSource(image: RawImageData, median: boolean | undefined): RawImageData {
  if (median === false) return image;
  return median === true ? medianFilter(image) : autoMedianFilter(image);
}
