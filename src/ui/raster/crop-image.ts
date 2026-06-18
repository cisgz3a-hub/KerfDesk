import {
  applyImageMaskToLuma,
  hasClosedImageMaskGeometry,
  whiteLuma,
  type VectorRaster,
} from '../../core/raster';
import type { Bounds, RasterImage, SceneObject } from '../../core/scene';
import { lumaToBitmap, type BitmapFields } from './luma-bitmap';

type PixelCrop = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type BitmapEncoder = (raster: VectorRaster) => BitmapFields | Promise<BitmapFields>;

const MASKED_PIXEL = 0;
const UNMASKED_PIXEL = 255;

export async function cropMaskedRasterImage(
  image: RasterImage,
  maskObject: SceneObject | null | undefined,
  encode: BitmapEncoder = lumaToBitmap,
): Promise<RasterImage> {
  const width = Math.max(1, Math.floor(image.pixelWidth));
  const height = Math.max(1, Math.floor(image.pixelHeight));
  assertUsableMask(image, maskObject);
  const maskProbe = applyImageMaskToLuma({
    image,
    maskObject,
    luma: new Uint8Array(width * height).fill(MASKED_PIXEL),
    width,
    height,
  });
  const crop = maskedPixelBounds(maskProbe, width, height);
  if (crop === null) {
    throw new Error('Image mask does not overlap the selected image.');
  }
  const sourceLuma = decodeLuma(image.lumaBase64, width * height);
  const maskedLuma = applyImageMaskToLuma({ image, maskObject, luma: sourceLuma, width, height });
  const croppedLuma = cropLuma(maskedLuma, width, crop);
  const croppedRaster = {
    width: crop.maxX - crop.minX,
    height: crop.maxY - crop.minY,
    luma: croppedLuma,
  };
  const fields = await encode(croppedRaster);
  const { imageMaskId: _imageMaskId, ...unmasked } = image;
  return {
    ...unmasked,
    dataUrl: fields.dataUrl,
    lumaBase64: fields.lumaBase64,
    pixelWidth: croppedRaster.width,
    pixelHeight: croppedRaster.height,
    bounds: cropLocalBounds(image.bounds, width, height, crop),
  };
}

function assertUsableMask(
  image: RasterImage,
  maskObject: SceneObject | null | undefined,
): asserts maskObject is SceneObject {
  if (image.imageMaskId === undefined) {
    throw new Error('Selected image does not have a mask to crop.');
  }
  if (maskObject?.id !== image.imageMaskId || !hasClosedImageMaskGeometry(maskObject)) {
    throw new Error('Image mask object is missing or no longer has closed geometry.');
  }
}

function maskedPixelBounds(luma: Uint8Array, width: number, height: number): PixelCrop | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (luma[y * width + x] === UNMASKED_PIXEL) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { minX, minY, maxX: maxX + 1, maxY: maxY + 1 };
}

function cropLuma(source: Uint8Array, sourceWidth: number, crop: PixelCrop): Uint8Array {
  const outWidth = crop.maxX - crop.minX;
  const outHeight = crop.maxY - crop.minY;
  const out = new Uint8Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y += 1) {
    const sourceBase = (crop.minY + y) * sourceWidth + crop.minX;
    const outBase = y * outWidth;
    for (let x = 0; x < outWidth; x += 1) {
      out[outBase + x] = source[sourceBase + x] ?? UNMASKED_PIXEL;
    }
  }
  return out;
}

function cropLocalBounds(
  bounds: Bounds,
  sourceWidth: number,
  sourceHeight: number,
  crop: PixelCrop,
): Bounds {
  const widthMm = bounds.maxX - bounds.minX;
  const heightMm = bounds.maxY - bounds.minY;
  return {
    minX: bounds.minX + (crop.minX / sourceWidth) * widthMm,
    minY: bounds.minY + (crop.minY / sourceHeight) * heightMm,
    maxX: bounds.minX + (crop.maxX / sourceWidth) * widthMm,
    maxY: bounds.minY + (crop.maxY / sourceHeight) * heightMm,
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
