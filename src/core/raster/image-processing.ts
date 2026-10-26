import type { DitherAlgorithm } from './dither';
import { applyLumaAdjustments, maybeInvertLuma, type LumaAdjustments } from './luma-adjust';
import { applyPhotoToneCurve, type PhotoToneCurve } from './photo-tone-curve';

type ImageProcessingSettings = {
  readonly passThrough: boolean;
  readonly negativeImage: boolean;
  readonly ditherAlgorithm: DitherAlgorithm;
  readonly photoToneCurve?: PhotoToneCurve | undefined;
};

// Shared by processed-bitmap preview/export and both compiler raster paths.
// Placement, masks, dot-width correction and the selected power range still apply;
// image adjustments and re-dithering must not change the source pixel pattern.
// ADR-670: a material tone calibration corrects the burn-side luma, after
// Negative, so it means the same marks for dark and light materials.
export function prepareImageLuma(
  source: Uint8Array,
  adjustments: LumaAdjustments,
  settings: ImageProcessingSettings,
): Uint8Array {
  return settings.passThrough
    ? source
    : applyPhotoToneCurve(
        maybeInvertLuma(applyLumaAdjustments(source, adjustments), settings.negativeImage),
        settings.photoToneCurve,
      );
}

export function imageDitherAlgorithm(settings: ImageProcessingSettings): DitherAlgorithm {
  return settings.passThrough ? 'grayscale' : settings.ditherAlgorithm;
}
