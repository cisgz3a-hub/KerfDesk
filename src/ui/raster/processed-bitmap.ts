import type { DeviceProfile } from '../../core/devices';
import {
  applyImageMaskToLuma,
  applyLumaAdjustments,
  dither,
  evaluateRasterBudget,
  maybeInvertLuma,
  pixelExtentForMm,
  rasterPreviewRgba,
  resampleLumaNearest,
  whiteLuma,
} from '../../core/raster';
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

export function buildProcessedRasterBitmap(
  image: RasterImage,
  layer: Layer,
  device: DeviceProfile,
  options: ProcessedRasterBitmapOptions = {},
): ProcessedRasterBitmap {
  const outputDimensions = processedRasterDimensions(image, layer);
  const { width, height } = capRasterDimensions(outputDimensions, options.maxEdge);
  const budget = evaluateRasterBudget(width, height, {
    sourcePixelCount: image.pixelWidth * image.pixelHeight,
    sourceWorkingBytesPerPixel: options.maxEdge === undefined ? 3 : 1,
    ditherAlgorithm: layer.ditherAlgorithm,
  });
  if (budget.kind === 'too-large') {
    return { kind: 'too-large', width, height, reason: budget.reason };
  }
  const decodedLuma = decodeLuma(image.lumaBase64, image.pixelWidth * image.pixelHeight);
  const previewResamplesSource =
    options.maxEdge !== undefined && (width !== image.pixelWidth || height !== image.pixelHeight);
  const sourceLuma = previewResamplesSource
    ? resampleLumaNearest(
        { luma: decodedLuma, width: image.pixelWidth, height: image.pixelHeight },
        width,
        height,
      )
    : decodedLuma;
  const adjustedLuma = applyLumaAdjustments(sourceLuma, image);
  const preparedLuma = maybeInvertLuma(adjustedLuma, layer.negativeImage);
  const sourceWidth = previewResamplesSource ? width : image.pixelWidth;
  const sourceHeight = previewResamplesSource ? height : image.pixelHeight;
  const luma =
    width === sourceWidth && height === sourceHeight
      ? preparedLuma
      : resampleLumaNearest(
          { luma: preparedLuma, width: sourceWidth, height: sourceHeight },
          width,
          height,
        );
  const maskedLuma = applyImageMaskToLuma({
    image,
    maskObject: options.maskObject,
    luma,
    width,
    height,
  });
  const sMax = powerToSMax(layer.power, device.maxPowerS);
  const sMin = minPowerToSMin(layer.minPower, layer.power, device.maxPowerS);
  const sValues = dither(
    { luma: maskedLuma, width, height },
    { algorithm: layer.ditherAlgorithm, sMax, sMin },
  );
  const rgba = new Uint8ClampedArray(rasterPreviewRgba(sValues, sMax, width, height));
  return { kind: 'ok', width, height, rgba };
}

export function processedRasterPreviewDimensions(
  image: RasterImage,
  layer: Layer,
): { readonly width: number; readonly height: number } {
  return capRasterDimensions(processedRasterDimensions(image, layer), 2048);
}

export function processedRasterDimensions(
  image: RasterImage,
  layer: Layer,
): { readonly width: number; readonly height: number } {
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

function powerToSMax(powerPercent: number, maxPowerS: number): number {
  const clamped = Math.max(0, Math.min(PERCENT_MAX, powerPercent));
  return Math.round((clamped / PERCENT_MAX) * maxPowerS);
}

function minPowerToSMin(minPowerPercent: number, powerPercent: number, maxPowerS: number): number {
  const maxPercent = Math.max(0, Math.min(PERCENT_MAX, powerPercent));
  const minPercent = Math.max(0, Math.min(maxPercent, minPowerPercent));
  return Math.round((minPercent / PERCENT_MAX) * maxPowerS);
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
