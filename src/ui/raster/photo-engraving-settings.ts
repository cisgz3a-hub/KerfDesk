import { effectiveOperationForObject } from '../../core/effective-output';
import { DEFAULT_SHARPEN_RADIUS } from '../../core/raster/luma-sharpen';
import { activePhotoToneCurve, type PhotoToneCurve } from '../../core/raster/photo-tone-curve';
import type { DitherAlgorithm, Layer, RasterImage } from '../../core/scene';
import type { PhotoEngravingApply } from './photo-engraving-apply';

/** The dithers that suit photographs, smoothest first by ADR-649's
 * low-frequency share (Blue Noise 0.82, Floyd–Steinberg 0.93, Stucki 1.59,
 * Jarvis 2.15; ADR-649 Amendment 1). The list sets only the window's order. */
export const PHOTO_DITHERS = [
  'blue-noise',
  'floyd-steinberg',
  'stucki',
  'jarvis',
] as const satisfies ReadonlyArray<DitherAlgorithm>;

export type PhotoDither = (typeof PHOTO_DITHERS)[number];
/** What the window burns with: a photo dither, or Grayscale kept for a photo
 * that already uses it, so a Grayscale tone calibration applies as measured
 * (ADR-670 Amendment 2). */
export type PhotoProcessing = PhotoDither | 'grayscale';
export type PhotoEngravingDraft = {
  readonly brightness: number;
  readonly contrast: number;
  readonly gamma: number;
  /** ADR-671 unsharp amount in percent; 0 is off. */
  readonly sharpenAmount: number;
  /** Gaussian sigma in burn cells. */
  readonly sharpenRadius: number;
  readonly ditherAlgorithm: PhotoProcessing;
  readonly linesPerMm: number;
  readonly negativeImage: boolean;
  /** ADR-670: the material tone calibration; undefined burns the tones uncorrected. */
  readonly photoToneCurve: PhotoToneCurve | undefined;
  /** ADR-711: power and speed picked from a burned Photo Test Card; undefined
   * keeps the operation's own. */
  readonly testedBurn: TestedBurn | undefined;
};

/** Burn power in percent and feed in mm/min, as a test card's square ran them. */
export type TestedBurn = {
  readonly power: number;
  readonly speed: number;
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
    ditherAlgorithm: photoProcessing(effective.ditherAlgorithm),
    linesPerMm: effective.linesPerMm,
    negativeImage: effective.negativeImage,
    photoToneCurve: activePhotoToneCurve(effective.photoToneCurve),
    testedBurn: undefined,
  };
}

/** A photo dither for a stored mode; other modes start with Jarvis (ADR-581). */
export function photoDither(value: string): PhotoDither {
  return PHOTO_DITHERS.find((dither) => dither === value) ?? 'jarvis';
}

/** The processing for a stored mode: Grayscale stays Grayscale (ADR-670
 * Amendment 2); any other mode is a photo dither, as photoDither picks it. */
export function photoProcessing(value: string): PhotoProcessing {
  return value === 'grayscale' ? 'grayscale' : photoDither(value);
}

/** The window offers the photo dithers, and Grayscale too when the photo
 * already burns with it. ADR-581 keeps Grayscale out otherwise: it modulates
 * power, so it needs a machine and material that shade. */
export function photoProcessingChoices(storedMode: string): ReadonlyArray<PhotoProcessing> {
  return storedMode === 'grayscale' ? [...PHOTO_DITHERS, 'grayscale'] : PHOTO_DITHERS;
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
      photoToneCurve: draft.photoToneCurve,
      ...(draft.testedBurn === undefined
        ? {}
        : { power: draft.testedBurn.power, speed: draft.testedBurn.speed }),
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
