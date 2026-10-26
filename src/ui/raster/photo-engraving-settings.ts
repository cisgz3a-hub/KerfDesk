import { effectiveOperationForObject } from '../../core/effective-output';
import { activePhotoToneCurve, type PhotoToneCurve } from '../../core/raster/photo-tone-curve';
import type { DitherAlgorithm, Layer, RasterImage } from '../../core/scene';
import type { PhotoEngravingApply } from './photo-engraving-apply';

/** The dithers that suit photographs, smoothest first (ADR-649 measures it). */
export const PHOTO_DITHERS = [
  'blue-noise',
  'jarvis',
  'stucki',
  'floyd-steinberg',
] as const satisfies ReadonlyArray<DitherAlgorithm>;

export type PhotoDither = (typeof PHOTO_DITHERS)[number];
export type PhotoEngravingDraft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  readonly ditherAlgorithm: PhotoDither;
  readonly linesPerMm: number;
  readonly negativeImage: boolean;
  /** ADR-670: the material tone calibration; undefined burns the tones uncorrected. */
  readonly photoToneCurve: PhotoToneCurve | undefined;
};

export function initialPhotoEngravingDraft(
  image: RasterImage,
  operation: Layer,
): PhotoEngravingDraft {
  const effective = effectiveOperationForObject(operation, image);
  return {
    brightness: image.brightness ?? 0,
    contrast: image.contrast ?? 0,
    gamma: image.gamma ?? 1,
    ditherAlgorithm: photoDither(effective.ditherAlgorithm),
    linesPerMm: effective.linesPerMm,
    negativeImage: effective.negativeImage,
    photoToneCurve: activePhotoToneCurve(effective.photoToneCurve),
  };
}

/** A photo dither for a stored mode; other modes start with Jarvis (ADR-581). */
export function photoDither(value: string): PhotoDither {
  return PHOTO_DITHERS.find((dither) => dither === value) ?? 'jarvis';
}

export function photoEngravingPatch(draft: PhotoEngravingDraft): PhotoEngravingApply {
  return {
    imagePatch: { brightness: draft.brightness, contrast: draft.contrast, gamma: draft.gamma },
    layerPatch: {
      ditherAlgorithm: draft.ditherAlgorithm,
      linesPerMm: draft.linesPerMm,
      negativeImage: draft.negativeImage,
      passThrough: false,
      photoToneCurve: draft.photoToneCurve,
    },
  };
}

export function photoSourceDimensions(image: RasterImage): {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly sourceDpi: number;
} {
  const widthMm = (image.bounds.maxX - image.bounds.minX) * Math.abs(image.transform.scaleX);
  const heightMm = (image.bounds.maxY - image.bounds.minY) * Math.abs(image.transform.scaleY);
  const sourceDpi =
    widthMm > 0 && heightMm > 0
      ? Math.min(image.pixelWidth / widthMm, image.pixelHeight / heightMm) * 25.4
      : 0;
  return { widthMm, heightMm, sourceDpi };
}
