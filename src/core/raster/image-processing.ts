import type { DitherAlgorithm } from './dither';
import { applyLumaAdjustments, maybeInvertLuma, type LumaAdjustments } from './luma-adjust';

type ImageProcessingSettings = {
  readonly passThrough: boolean;
  readonly negativeImage: boolean;
  readonly ditherAlgorithm: DitherAlgorithm;
};

// Shared by processed-bitmap preview/export and both compiler raster paths.
// Placement, masks, dot-width correction and the selected power range still apply;
// image adjustments and re-dithering must not change the source pixel pattern.
export function prepareImageLuma(
  source: Uint8Array,
  adjustments: LumaAdjustments,
  settings: ImageProcessingSettings,
): Uint8Array {
  return settings.passThrough
    ? source
    : maybeInvertLuma(applyLumaAdjustments(source, adjustments), settings.negativeImage);
}

export function imageDitherAlgorithm(settings: ImageProcessingSettings): DitherAlgorithm {
  return settings.passThrough ? 'grayscale' : settings.ditherAlgorithm;
}
