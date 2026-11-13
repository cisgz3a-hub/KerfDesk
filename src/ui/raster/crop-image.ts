import { intersectClosedPolylinesChecked } from '../../core/geometry/polygon-intersection';
import {
  hasClosedImageMaskGeometry,
  MIN_RASTER_LINES_PER_MM,
  type VectorRaster,
} from '../../core/raster';
import { closedImageClipContours } from '../../core/raster/image-mask';
import { bakedImageMaskClip } from '../../core/raster/image-mask-clip';
import { SHARPEN_RADIUS_MAX } from '../../core/raster/luma-sharpen';
import type { Bounds, ColoredPath, Polyline, RasterImage, SceneObject } from '../../core/scene';
import {
  hydratePagedRasterImage,
  type PagedRasterAssetReader,
} from '../import/paged-raster-hydration';
import { readRasterSourceFile } from '../import/paged-raster-source';
import {
  extractLumaBase64,
  fitDecodeToStoredGrid,
  loadImageAsRawData,
} from '../trace/image-loader';
import { lumaToBitmap, type BitmapFields } from './luma-bitmap';

type PixelCrop = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type BitmapEncoder = (raster: VectorRaster) => BitmapFields | Promise<BitmapFields>;

const UNMASKED_PIXEL = 255;
// The bake keeps real pixels at the mask edge and lets the owned clip alone
// decide what burns (ADR-480 Amendment 6). Compile sharpens the burn grid
// before the clip, so the crop keeps a margin of real pixels around the
// mask at least three sigmas of the widest sharpen radius, plus one cell, at
// the coarsest recommended line interval: no burn cell inside the mask then
// reads a pixel the crop removed, under any sharpening or resampling.
const SHARPEN_KERNEL_SIGMAS = 3;
const BAKE_MARGIN_MM = (SHARPEN_KERNEL_SIGMAS * SHARPEN_RADIUS_MAX + 1) / MIN_RASTER_LINES_PER_MM;

export async function cropMaskedRasterImage(
  image: RasterImage,
  maskObject: SceneObject | null | undefined,
  encode: BitmapEncoder = lumaToBitmap,
  repository?: PagedRasterAssetReader,
): Promise<RasterImage> {
  const width = Math.max(1, Math.floor(image.pixelWidth));
  const height = Math.max(1, Math.floor(image.pixelHeight));
  assertUsableMask(image, maskObject);
  // The mask's shape stays as the image's own clip, applied where the live
  // mask was (ADR-480 Amendment 1). The clip is in the image's local frame,
  // which a crop keeps. It is the only thing that hides pixels: whitening
  // them in the bitmap moved the edge onto the source grid and gave sharpened
  // edges a rim (ADR-480 Amendment 6).
  const imageClip = bakedImageMaskClip(image, maskObject);
  if (imageClip === null) {
    throw new Error('Could not keep the mask shape with the image.');
  }
  const crop = clipPixelBox(image, imageClip, width, height);
  if (crop === null) {
    throw new Error('Image mask does not overlap the selected image.');
  }
  const source = await hydratePagedRasterImage(image, repository);
  const sourceLuma = await readCropLuma(source, width, height);
  const croppedRaster = {
    width: crop.maxX - crop.minX,
    height: crop.maxY - crop.minY,
    luma: cropLuma(sourceLuma, width, crop),
  };
  const fields = await encode(croppedRaster);
  const { imageMaskId: _imageMaskId, editorDocument: _editorDocument, ...unmasked } = source;
  return {
    ...unmasked,
    dataUrl: fields.dataUrl,
    lumaBase64: fields.lumaBase64,
    pixelWidth: croppedRaster.width,
    pixelHeight: croppedRaster.height,
    bounds: cropLocalBounds(image.bounds, width, height, crop),
    imageClip,
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

/**
 * The source pixels the clip touches inside the image, grown by the bake
 * margin and kept within the image; null when the clip and the image share
 * no area. Measured on the clip's geometry, not on pixel centres, so a mask
 * smaller than one pixel still crops to the pixels it covers.
 */
function clipPixelBox(
  image: RasterImage,
  imageClip: ReadonlyArray<ColoredPath>,
  width: number,
  height: number,
): PixelCrop | null {
  const b = image.bounds;
  const widthMm = b.maxX - b.minX;
  const heightMm = b.maxY - b.minY;
  if (!(widthMm > 0 && heightMm > 0)) return null;
  const clip: Polyline[] = closedImageClipContours(imageClip).map((points) => ({
    points: [...points],
    closed: true,
  }));
  const frame: Polyline = {
    points: [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ],
    closed: true,
  };
  const overlap = intersectClosedPolylinesChecked(clip, [frame]);
  const box = pointBox(overlap.kind === 'ok' ? overlap.value : clip);
  if (box === null || !(box.maxX > box.minX && box.maxY > box.minY)) return null;
  const pitchX = widthMm / width;
  const pitchY = heightMm / height;
  // The margin is measured where the burn grid is: in scene millimetres.
  const marginX = Math.ceil(
    BAKE_MARGIN_MM / Math.max(Number.EPSILON, pitchX * Math.abs(image.transform.scaleX)),
  );
  const marginY = Math.ceil(
    BAKE_MARGIN_MM / Math.max(Number.EPSILON, pitchY * Math.abs(image.transform.scaleY)),
  );
  const crop = {
    minX: Math.max(0, Math.floor((box.minX - b.minX) / pitchX) - marginX),
    minY: Math.max(0, Math.floor((box.minY - b.minY) / pitchY) - marginY),
    maxX: Math.min(width, Math.ceil((box.maxX - b.minX) / pitchX) + marginX),
    maxY: Math.min(height, Math.ceil((box.maxY - b.minY) / pitchY) + marginY),
  };
  return crop.maxX > crop.minX && crop.maxY > crop.minY ? crop : null;
}

function pointBox(contours: ReadonlyArray<Polyline>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const contour of contours) {
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
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

async function readCropLuma(
  image: RasterImage,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const stored = decodeLuma(image.lumaBase64, width * height);
  if (stored !== null) return stored;
  // Older embedded images may lack luminance. Recover their actual pixels;
  // missing or corrupt source data must never become a successful white crop.
  const file = await readRasterSourceFile(image, 'crop-image-source');
  const pixels = fitDecodeToStoredGrid(
    await loadImageAsRawData(file, Math.max(width, height)),
    width,
    height,
  );
  if (pixels.width !== width || pixels.height !== height) {
    throw new Error('Image source dimensions do not match the selected image.');
  }
  const luma = decodeLuma(extractLumaBase64(pixels), width * height);
  if (luma === null) throw new Error('Could not read the image pixels to crop.');
  return luma;
}

function decodeLuma(base64: string | undefined, expectedLength: number): Uint8Array | null {
  if (base64 === undefined) return null;
  try {
    const binary = atob(base64);
    if (binary.length !== expectedLength) return null;
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
