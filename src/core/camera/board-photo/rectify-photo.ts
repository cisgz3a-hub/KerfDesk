import type { BedArea } from '../model/camera-model-accuracy';
import { applyHomography, invertMat3, type Mat3 } from '../homography';
import { writeBilinear, type RgbaImage } from '../rgba-image';
import type { PhotoReference } from './photo-quad';

export function rectifiedRegion(
  imageWidth: number,
  imageHeight: number,
  toMm: Mat3,
  ref: PhotoReference,
): { readonly region: BedArea; readonly pixelsPerMm: number; readonly coarse: boolean } {
  const sourceCorners = [
    { x: 0, y: 0 },
    { x: imageWidth, y: 0 },
    { x: imageWidth, y: imageHeight },
    { x: 0, y: imageHeight },
  ] as const;
  const corners = sourceCorners.map((point) => {
    const w = toMm[6] * point.x + toMm[7] * point.y + toMm[8];
    if (!(w > 0) || !Number.isFinite(w)) return null;
    const mapped = applyHomography(toMm, point);
    return Number.isFinite(mapped.x) && Number.isFinite(mapped.y) ? mapped : null;
  });
  const region = boundedMappedRegion(corners, ref);
  const pixelsPerMm = Math.min(4, 2048 / Math.max(region.width, region.height));
  return { region, pixelsPerMm, coarse: pixelsPerMm < 1 };
}

function boundedMappedRegion(
  corners: ReadonlyArray<{ readonly x: number; readonly y: number } | null>,
  ref: PhotoReference,
): BedArea {
  const referenceWidth = positiveFinite(ref.widthMm) ? ref.widthMm : 0;
  const referenceHeight = positiveFinite(ref.heightMm) ? ref.heightMm : 0;
  const clamp = {
    minX: -1000,
    minY: -1000,
    maxX: referenceWidth + 1000,
    maxY: referenceHeight + 1000,
  };
  const valid = corners.filter((point): point is NonNullable<typeof point> => point !== null);
  if (valid.length === 0) return clampRegion(clamp);
  const xs = valid.map((point) => point.x);
  const ys = valid.map((point) => point.y);
  const leftComplete = completePair(corners, 0, 3);
  const rightComplete = completePair(corners, 1, 2);
  const topComplete = completePair(corners, 0, 1);
  const bottomComplete = completePair(corners, 2, 3);
  const bounds = {
    minX: leftComplete ? Math.max(clamp.minX, Math.min(...xs)) : clamp.minX,
    minY: topComplete ? Math.max(clamp.minY, Math.min(...ys)) : clamp.minY,
    maxX: rightComplete ? Math.min(clamp.maxX, Math.max(...xs)) : clamp.maxX,
    maxY: bottomComplete ? Math.min(clamp.maxY, Math.max(...ys)) : clamp.maxY,
  };
  if (invalidBounds(bounds)) return clampRegion(clamp);
  return clampRegion(bounds);
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function completePair(
  corners: ReadonlyArray<unknown | null>,
  first: number,
  second: number,
): boolean {
  return corners[first] !== null && corners[second] !== null;
}

function invalidBounds(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): boolean {
  return (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.maxX <= bounds.minX ||
    bounds.maxY <= bounds.minY
  );
}

function clampRegion(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): BedArea {
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

export function rectifyPhoto(
  image: RgbaImage,
  toMm: Mat3,
  region: BedArea,
  pixelsPerMm: number,
): RgbaImage {
  const inverse = invertMat3(toMm);
  const width = Math.max(1, Math.ceil(region.width * pixelsPerMm));
  const height = Math.max(1, Math.ceil(region.height * pixelsPerMm));
  const data = new Uint8ClampedArray(width * height * 4);
  if (inverse === null) return { data, width, height };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const mm = {
        x: region.x + (x + 0.5) / pixelsPerMm,
        y: region.y + (y + 0.5) / pixelsPerMm,
      };
      const pixel = applyHomography(inverse, mm);
      writeBilinear(data, (y * width + x) * 4, image, pixel.x, pixel.y);
    }
  }
  return { data, width, height };
}
