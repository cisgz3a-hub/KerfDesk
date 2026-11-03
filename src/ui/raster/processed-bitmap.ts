import type { DeviceProfile } from '../../core/devices';
import {
  effectiveObjectMinPowerPercent,
  effectiveObjectPowerPercent,
  effectiveOperationForObject,
} from '../../core/effective-output';
import {
  applyImageMaskToLuma,
  dither,
  evaluateRasterBudget,
  pixelExtentForMm,
  rasterPreviewRgba,
  resampleLuma,
  whiteLuma,
} from '../../core/raster';
import { rasterCompilationPowerScale } from '../../core/raster/controller-power-scale';
import { MAX_RASTER_SOURCE_READ_PIXELS } from '../../core/raster/raster-budget';
import { imageDitherAlgorithm, prepareImageLuma } from '../../core/raster/image-processing';
import { burnGridKernel } from '../../core/raster/luma-resample';
import { burnGridSharpen, gridSharpen, sharpenLuma } from '../../core/raster/luma-sharpen';
import type { Layer, RasterImage, SceneObject } from '../../core/scene';

const PERCENT_MAX = 100;

export type ProcessedRasterBitmap =
  | {
      readonly kind: 'ok';
      readonly width: number;
      readonly height: number;
      readonly rgba: Uint8ClampedArray<ArrayBuffer>;
    }
  | {
      readonly kind: 'too-large';
      readonly width: number;
      readonly height: number;
      readonly reason: string;
    };

export type ProcessedRasterBitmapOptions = {
  readonly maskObject?: SceneObject | null;
  readonly maxEdge?: number;
};

/**
 * The bitmap `image` burns as on `operation`, the layer it is assigned to. The
 * image's own settings and power scale are resolved here exactly as compile
 * resolves them, so a caller cannot export the operation's raw settings.
 */
export function buildProcessedRasterBitmap(
  image: RasterImage,
  operation: Layer,
  device: DeviceProfile,
  options: ProcessedRasterBitmapOptions = {},
): ProcessedRasterBitmap {
  const layer = effectiveOperationForObject(operation, image);
  const outputDimensions = processedRasterDimensions(image, layer);
  const { width, height } = capRasterDimensions(outputDimensions, options.maxEdge);
  const limit = processedBitmapSizeLimit(image, layer, width, height);
  if (limit !== null) return { kind: 'too-large', width, height, reason: limit };
  const decodedLuma = decodeLuma(image.lumaBase64, image.pixelWidth * image.pixelHeight);
  // Adjust at source resolution, then resample once — the burn's own order.
  // Averaging first and adjusting after would differ for any non-linear curve.
  const preparedLuma = prepareImageLuma(decodedLuma, image, layer);
  const luma =
    width === image.pixelWidth && height === image.pixelHeight
      ? preparedLuma
      : resampleLuma(
          { luma: preparedLuma, width: image.pixelWidth, height: image.pixelHeight },
          width,
          height,
          burnGridKernel(imageDitherAlgorithm(layer)),
        );
  // Compile's own sharpening (ADR-671), its burn-cell radius kept the same
  // size in millimetres on a capped preview grid.
  const sharpen = burnGridSharpen(image, layer.passThrough);
  const burnLuma =
    sharpen === null
      ? luma
      : sharpenLuma(
          luma,
          width,
          height,
          gridSharpen(sharpen, outputDimensions.width / width, outputDimensions.height / height),
        );
  const maskedLuma = applyImageMaskToLuma({
    image,
    maskObject: options.maskObject,
    luma: burnLuma,
    width,
    height,
  });
  // Compile's own power range: the image's power scale and the controller's
  // dithering units (a 0..1 controller would otherwise round 30% down to 0).
  const compilationMaxS = rasterCompilationPowerScale(device);
  const sMax = Math.round(
    (effectiveObjectPowerPercent(layer, image) / PERCENT_MAX) * compilationMaxS,
  );
  const sMin = Math.round(
    (effectiveObjectMinPowerPercent(layer, image) / PERCENT_MAX) * compilationMaxS,
  );
  const sValues = dither(
    { luma: maskedLuma, width, height },
    { algorithm: imageDitherAlgorithm(layer), sMax, sMin },
  );
  const rgba = new Uint8ClampedArray(rasterPreviewRgba(sValues, sMax, width, height));
  return { kind: 'ok', width, height, rgba };
}

/**
 * Why the bitmap cannot be built, in plain words, or null. ADR-581 Amendment 1:
 * the source is one read under its own pixel ceiling; the 64 MB budget is for
 * the bitmap built at the output grid.
 */
export function processedBitmapSizeLimit(
  image: RasterImage,
  operation: Layer,
  width: number,
  height: number,
): string | null {
  const sourcePixels = image.pixelWidth * image.pixelHeight;
  if (sourcePixels > MAX_RASTER_SOURCE_READ_PIXELS) {
    return `the photo has too many pixels (${(sourcePixels / 1_000_000).toFixed(0)} megapixels; up to ${MAX_RASTER_SOURCE_READ_PIXELS / 1_000_000} can be read). Crop it in Image Studio or import a smaller copy.`;
  }
  const layer = effectiveOperationForObject(operation, image);
  const budget = evaluateRasterBudget(width, height, {
    ditherAlgorithm: imageDitherAlgorithm(layer),
  });
  return budget.kind === 'ok'
    ? null
    : 'the bitmap is too big at this size and resolution. Lower the resolution or make the photo smaller.';
}

export function processedRasterPreviewDimensions(
  image: RasterImage,
  layer: Layer,
): { readonly width: number; readonly height: number } {
  return capRasterDimensions(processedRasterDimensions(image, layer), 2048);
}

export function processedRasterDimensions(
  image: RasterImage,
  operation: Layer,
): { readonly width: number; readonly height: number } {
  const layer = effectiveOperationForObject(operation, image);
  if (layer.passThrough) {
    return {
      width: Math.max(1, Math.floor(image.pixelWidth)),
      height: Math.max(1, Math.floor(image.pixelHeight)),
    };
  }
  return {
    width: pixelExtentForMm(
      (image.bounds.maxX - image.bounds.minX) * Math.abs(image.transform.scaleX),
      layer.linesPerMm,
    ),
    height: pixelExtentForMm(
      (image.bounds.maxY - image.bounds.minY) * Math.abs(image.transform.scaleY),
      layer.linesPerMm,
    ),
  };
}

function capRasterDimensions(
  dimensions: { readonly width: number; readonly height: number },
  maxEdge: number | undefined,
): { readonly width: number; readonly height: number } {
  if (maxEdge === undefined || maxEdge <= 0) return dimensions;
  const edge = Math.max(dimensions.width, dimensions.height);
  if (edge <= maxEdge) return dimensions;
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale)),
  };
}

function decodeLuma(base64: string | undefined, expectedLength: number): Uint8Array {
  const out = whiteLuma(expectedLength);
  if (base64 === undefined) return out;
  try {
    const binary = atob(base64);
    const n = Math.min(binary.length, expectedLength);
    for (let i = 0; i < n; i += 1) out[i] = binary.charCodeAt(i);
  } catch {
    return out;
  }
  return out;
}
