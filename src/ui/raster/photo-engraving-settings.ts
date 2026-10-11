import { effectiveOperationForObject } from '../../core/effective-output';
import type { Layer, RasterImage } from '../../core/scene';
import type { PhotoEngravingApply } from './photo-engraving-apply';

export const PHOTO_DITHER_CHOICES = [
  { value: 'jarvis', label: 'Jarvis · smooth photographic shading' },
  { value: 'stucki', label: 'Stucki · fine photographic texture' },
  { value: 'floyd-steinberg', label: 'Floyd–Steinberg · classic dot pattern' },
] as const;

export type PhotoDither = (typeof PHOTO_DITHER_CHOICES)[number]['value'];
export type PhotoEngravingDraft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
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
    imagePatch: { brightness: draft.brightness, contrast: draft.contrast, gamma: draft.gamma },
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
