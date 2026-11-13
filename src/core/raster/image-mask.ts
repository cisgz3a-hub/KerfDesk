import {
  normalizeClosedPolylinesEvenOddChecked,
  normalizeClosedPolylinesNonZeroChecked,
} from '../geometry/polygon-difference';
import {
  applyTransform,
  assertNever,
  IDENTITY_TRANSFORM,
  isClosedEnough,
  type ColoredPath,
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
  const owned =
    image.imageClip === undefined
      ? null
      : createRowScanlineTest(
          { ...image, transform: IDENTITY_TRANSFORM },
          closedImageClipContours(image.imageClip),
          width,
          height,
        );
  const externalContours =
    image.imageMaskId !== undefined && maskObject?.id === image.imageMaskId
      ? closedMaskContours(maskObject)
      : [];
  if (externalContours.length === 0) return owned;
  const external = createRowScanlineTest(image, externalContours, width, height);
  return owned === null ? external : (x, y) => owned(x, y) && external(x, y);
}

export function closedImageClipContours(paths: readonly ColoredPath[]): MaskContours {
  return paths.flatMap((path) => path.polylines.filter(isMaskContour).map((line) => line.points));
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
  return maskPathGroups(object).length > 0;
}

type MaskFillRule = NonNullable<ColoredPath['fillRule']>;

type MaskPathGroup = {
  readonly fillRule: MaskFillRule;
  readonly contours: MaskContours;
};

const maskRegionCache = new WeakMap<SceneObject, MaskContours>();

/**
 * The region an image mask keeps, in scene space, as contours read even-odd:
 * the area Fill fills for the same object (ADR-480 Amendment 6). Each path is
 * resolved under its own fill rule (text and a declared `nonzero` path by
 * winding, everything else even-odd) and the paths are then unioned, the way
 * layer-fill.ts resolves one object before it pools a layer. Every consumer
 * (compile, Preview, preflight, Crop/Flatten, Trace, Save Processed Bitmap
 * and the design canvas) reads this one region.
 *
 * Scene objects are immutable, so the region is cached per object. A single
 * even-odd path, or even-odd paths whose boxes never overlap, already is that
 * region and keeps its exact contours; the boolean engine resolves the rest.
 * If the engine fails, the raw even-odd contours stand in, as they do in Fill.
 */
export function closedMaskContours(object: SceneObject): MaskContours {
  const cached = maskRegionCache.get(object);
  if (cached !== undefined) return cached;
  const region = maskRegionContours(maskPathGroups(object));
  maskRegionCache.set(object, region);
  return region;
}

function maskRegionContours(groups: ReadonlyArray<MaskPathGroup>): MaskContours {
  const raw = groups.flatMap((group) => group.contours);
  if (groups.every((group) => group.fillRule === 'evenodd') && boxesAreDisjoint(groups)) {
    return raw;
  }
  const resolved: Polyline[] = [];
  for (const group of groups) {
    const polylines = group.contours.map((points) => ({ points: [...points], closed: true }));
    const normalized =
      group.fillRule === 'nonzero'
        ? normalizeClosedPolylinesNonZeroChecked(polylines)
        : normalizeClosedPolylinesEvenOddChecked(polylines);
    if (normalized.kind === 'error') return raw;
    for (const polyline of normalized.value) resolved.push(polyline);
  }
  const union = groups.length === 1 ? null : normalizeClosedPolylinesNonZeroChecked(resolved);
  const contours = union?.kind === 'ok' ? union.value : resolved;
  return contours
    .filter((polyline) => polyline.points.length >= MIN_MASK_POINTS)
    .map((polyline) => polyline.points);
}

function maskPathGroups(object: SceneObject): ReadonlyArray<MaskPathGroup> {
  switch (object.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return object.paths.flatMap((path): MaskPathGroup[] => {
        const contours = path.polylines
          .filter((polyline) => isMaskContour(polyline))
          .map((polyline) =>
            polyline.points.map((point) => applyTransform(point, object.transform)),
          );
        if (contours.length === 0) return [];
        // The rule layer-fill.ts resolves the same path with (ADR-286).
        const fillRule = path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd');
        return [{ fillRule, contours }];
      });
    case 'raster-image':
    case 'relief':
      return [];
    default:
      return assertNever(object, 'SceneObject');
  }
}

type ContourBox = { minX: number; minY: number; maxX: number; maxY: number };

// Even-odd paths that share no area XOR and union alike, so they need no
// boolean pass. Bounding boxes make the check conservative.
function boxesAreDisjoint(groups: ReadonlyArray<MaskPathGroup>): boolean {
  if (groups.length < 2) return true;
  const boxes = groups.map((group) => contourBox(group.contours));
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    for (let j = i + 1; j < boxes.length; j += 1) {
      const b = boxes[j];
      if (a === undefined || b === undefined) continue;
      if (a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY) {
        return false;
      }
    }
  }
  return true;
}

function contourBox(contours: MaskContours): ContourBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const contour of contours) {
    for (const point of contour) {
      box.minX = Math.min(box.minX, point.x);
      box.minY = Math.min(box.minY, point.y);
      box.maxX = Math.max(box.maxX, point.x);
      box.maxY = Math.max(box.maxY, point.y);
    }
  }
  return box;
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
