import {
  applyTransform,
  assertNever,
  isClosedEnough,
  type Polyline,
  type RasterImage,
  type SceneObject,
  type Vec2,
} from '../scene';
import { isInsideRowCrossings, maskRowCrossings, type MaskContours } from './mask-scanline';

const WHITE_LUMA_BYTE = 255;
const MIN_MASK_POINTS = 3;

export type ImageMaskInput = {
  readonly image: RasterImage;
  readonly maskObject: SceneObject | null | undefined;
  readonly luma: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export function applyImageMaskToLuma(input: ImageMaskInput): Uint8Array {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const insideMask = createImageMaskPixelTest(input.image, input.maskObject, width, height);
  if (insideMask === null) return input.luma;
  const out = new Uint8Array(input.luma);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!insideMask(x, y)) out[y * width + x] = WHITE_LUMA_BYTE;
    }
  }
  return out;
}

/**
 * Per-pixel mask membership test on the image's target pixel grid, or null
 * when no mask applies. Row-streaming raster compiles use this to whiten
 * masked-out pixels one row at a time instead of materializing the full
 * masked luma buffer (ADR-243). Coordinates are the PRE-orientation target
 * grid — the same grid applyImageMaskToLuma masks.
 */
export function createImageMaskPixelTest(
  image: RasterImage,
  maskObject: SceneObject | null | undefined,
  width: number,
  height: number,
): ((x: number, y: number) => boolean) | null {
  if (image.imageMaskId === undefined) return null;
  if (maskObject?.id !== image.imageMaskId) return null;
  const contours = closedMaskContours(maskObject);
  if (contours.length === 0) return null;
  return createRowScanlineTest(image, contours, width, height);
}

// Every pixel on a scan line shares one crossing list, and both callers walk a
// row's pixels together, so caching the current row turns the mask test from
// O(pixels x contourPoints) into O(rows x contourPoints + pixels x log
// crossings). A row that is not a scene-space scan line keeps the exact
// per-pixel test.
function createRowScanlineTest(
  image: RasterImage,
  contours: MaskContours,
  width: number,
  height: number,
): (x: number, y: number) => boolean {
  let cachedRow: number | null = null;
  let cachedCrossings: Float64Array | null = null;
  return (x, y) => {
    if (cachedRow !== y) {
      cachedRow = y;
      cachedCrossings = horizontalRowCrossings(image, contours, y, width, height);
    }
    const point = pixelCenterInScene(image, x, y, width, height);
    return cachedCrossings === null
      ? pointInEvenOdd(point, contours)
      : isInsideRowCrossings(cachedCrossings, point.x);
  };
}

// A pixel row lies on ONE scene-space scan line only when the object transform
// contributes no rotation to its scene y. Every step from pixel x to scene y is
// monotonic in x — and IEEE rounding is monotonic too — so equal scene y at
// both ends of the row proves every pixel between them shares that y, which
// also covers the 1e-16 sine dust Math.sin leaves at 180 and 360 degrees.
// Rotated rows (and any NaN transform, which fails the equality) return null.
function horizontalRowCrossings(
  image: RasterImage,
  contours: MaskContours,
  y: number,
  width: number,
  height: number,
): Float64Array | null {
  const firstY = pixelCenterInScene(image, 0, y, width, height).y;
  const lastY = pixelCenterInScene(image, width - 1, y, width, height).y;
  if (firstY !== lastY) return null;
  return maskRowCrossings(contours, firstY);
}

export function hasClosedImageMaskGeometry(object: SceneObject): boolean {
  return closedMaskContours(object).length > 0;
}

function closedMaskContours(object: SceneObject): ReadonlyArray<ReadonlyArray<Vec2>> {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return object.paths.flatMap((path) =>
        path.polylines
          .filter((polyline) => isMaskContour(polyline))
          .map((polyline) =>
            polyline.points.map((point) => applyTransform(point, object.transform)),
          ),
      );
    case 'raster-image':
    case 'relief':
      return [];
    default:
      return assertNever(object, 'SceneObject');
  }
}

function isMaskContour(polyline: Polyline): boolean {
  return polyline.points.length >= MIN_MASK_POINTS && isClosedEnough(polyline);
}

function pixelCenterInScene(
  image: RasterImage,
  x: number,
  y: number,
  width: number,
  height: number,
): Vec2 {
  const local = {
    x: image.bounds.minX + ((x + 0.5) / width) * (image.bounds.maxX - image.bounds.minX),
    y: image.bounds.minY + ((y + 0.5) / height) * (image.bounds.maxY - image.bounds.minY),
  };
  return applyTransform(local, image.transform);
}

function pointInEvenOdd(point: Vec2, contours: MaskContours): boolean {
  let inside = false;
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i += 1) {
      const a = contour[i];
      const b = contour[(i + 1) % contour.length];
      if (a === undefined || b === undefined) continue;
      if (a.y > point.y === b.y > point.y) continue;
      const x = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (point.x < x) inside = !inside;
    }
  }
  return inside;
}
