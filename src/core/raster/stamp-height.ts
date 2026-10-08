import { evaluateRasterBudget } from './raster-budget';
import { squaredFaceEdgeDistance } from './stamp-distance';

export const MAX_STAMP_PIXELS = 2_000_000;
export const MAX_STAMP_EDGE = 8192;
export type StampRequest = {
  readonly threshold: number;
  readonly taperMm: number;
  readonly mirror: boolean;
};
export type StampSourcePixels = {
  readonly width: number;
  readonly height: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly luma: Uint8Array;
};
export type StampHeightDraft = {
  readonly width: number;
  readonly height: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly pitchXmm: number;
  readonly pitchYmm: number;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly facePixels: number;
  readonly face: Uint8Array;
  readonly luma: Uint8Array;
};

/** Offline design intent only. White is the raised face; no material depth,
 * laser power or controller setting is inferred from these bytes. */
export function prepareStampHeight(
  source: StampSourcePixels,
  request: StampRequest,
): StampHeightDraft {
  assertStampSource(source);
  if (!Number.isInteger(request.threshold) || request.threshold < 0 || request.threshold > 254)
    throw new Error('Use an integer source threshold from 0 to 254.');
  if (!Number.isFinite(request.taperMm) || request.taperMm < 0 || request.taperMm > 100)
    throw new Error('Use a measured taper width from 0 to 100 mm.');
  const pitchXmm = source.widthMm / source.width;
  const pitchYmm = source.heightMm / source.height;
  const paddingX = Math.ceil(request.taperMm / pitchXmm) + 1;
  const paddingY = Math.ceil(request.taperMm / pitchYmm) + 1;
  const width = source.width + paddingX * 2;
  const height = source.height + paddingY * 2;
  assertStampDimensions(width, height);
  const face = new Uint8Array(width * height);
  const facePixels = populateFace(source, request, face, width, paddingX, paddingY);
  if (facePixels === 0) throw new Error('No raised face remains at this threshold.');
  const distances = squaredFaceEdgeDistance(face, width, height, pitchXmm, pitchYmm);
  const luma = heightPixels(face, distances, request.taperMm);
  return {
    width,
    height,
    widthMm: width * pitchXmm,
    heightMm: height * pitchYmm,
    pitchXmm,
    pitchYmm,
    paddingX,
    paddingY,
    facePixels,
    face,
    luma,
  };
}

export function assertStampDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_STAMP_EDGE ||
    height > MAX_STAMP_EDGE ||
    width * height > MAX_STAMP_PIXELS
  )
    throw new Error(
      'Stamp preparation is limited to 2,000,000 pixels and 8192 pixels per edge. Lower vector DPI or resize a copy in Image Studio.',
    );
  const budget = evaluateRasterBudget(width, height, {
    sourcePixelCount: width * height,
    sourceWorkingBytesPerPixel: 16,
  });
  if (budget.kind === 'too-large') throw new Error(`Stamp preparation: ${budget.reason}`);
}

function assertStampSource(source: StampSourcePixels): void {
  assertStampDimensions(source.width, source.height);
  if (source.luma.length !== source.width * source.height)
    throw new Error('Source pixel bytes do not match its dimensions.');
  if (![source.widthMm, source.heightMm].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Source must have finite positive physical dimensions.');
}
function populateFace(
  source: StampSourcePixels,
  request: StampRequest,
  face: Uint8Array,
  width: number,
  paddingX: number,
  paddingY: number,
): number {
  let count = 0;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const sx = request.mirror ? source.width - 1 - x : x;
      if ((source.luma[y * source.width + sx] ?? 255) > request.threshold) continue;
      face[(y + paddingY) * width + x + paddingX] = 1;
      count += 1;
    }
  }
  return count;
}
function heightPixels(face: Uint8Array, distance: Float64Array, taperMm: number): Uint8Array {
  const out = new Uint8Array(face.length);
  for (let index = 0; index < out.length; index += 1) {
    if (face[index] === 1) out[index] = 255;
    else if (taperMm > 0)
      out[index] = Math.round(
        255 * Math.max(0, 1 - Math.sqrt(distance[index] ?? Infinity) / taperMm),
      );
  }
  return out;
}
