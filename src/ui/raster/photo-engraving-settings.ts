import { effectiveOperationForObject } from '../../core/effective-output';
import { DEFAULT_SHARPEN_RADIUS } from '../../core/raster/luma-sharpen';
import type { DitherAlgorithm, Layer, RasterImage } from '../../core/scene';
import type { PhotoEngravingApply } from './photo-engraving-apply';

/** The dithers that suit photographs, smoothest first. */
export const PHOTO_DITHERS = [
  'jarvis',
  'stucki',
  'floyd-steinberg',
] as const satisfies ReadonlyArray<DitherAlgorithm>;

export type PhotoDither = (typeof PHOTO_DITHERS)[number];
export type PhotoEngravingDraft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  /** ADR-648 unsharp amount in percent; 0 is off. */
  readonly sharpenAmount: number;
  /** Gaussian sigma in burn cells. */
  readonly sharpenRadius: number;
  readonly ditherAlgorithm: PhotoDither;
  readonly linesPerMm: number;
  readonly negativeImage: boolean;
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
    sharpenAmount: image.sharpenAmount ?? 0,
    sharpenRadius: image.sharpenRadius ?? DEFAULT_SHARPEN_RADIUS,
    ditherAlgorithm: photoDither(effective.ditherAlgorithm),
    linesPerMm: effective.linesPerMm,
    negativeImage: effective.negativeImage,
  };
}

export function photoDither(value: string): PhotoDither {
  return value === 'stucki' || value === 'floyd-steinberg' ? value : 'jarvis';
}

export function photoEngravingPatch(draft: PhotoEngravingDraft): PhotoEngravingApply {
  return {
    imagePatch: {
      brightness: draft.brightness,
      contrast: draft.contrast,
      gamma: draft.gamma,
      sharpenAmount: draft.sharpenAmount,
      sharpenRadius: draft.sharpenRadius,
    },
    layerPatch: {
      ditherAlgorithm: draft.ditherAlgorithm,
      linesPerMm: draft.linesPerMm,
      negativeImage: draft.negativeImage,
      passThrough: false,
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
