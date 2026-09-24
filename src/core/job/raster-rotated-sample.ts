// Rotated raster sampling — maps machine scan-grid pixel centers back into
// the source bitmap. Scan rows must stay horizontal in machine space, so a
// rotated image cannot reuse the axis-aligned resample + flip pipeline;
// instead each machine pixel center is mapped through the device-origin
// inverse and the inverse object transform into source pixels. Points outside
// the image footprint read white, so the bounding-box padding around the
// rotated content stays unburned. Zero-rotation images keep the legacy
// pipeline (byte-identical output; see compile-job-raster.ts).

import { toSceneCoords, type DeviceProfile } from '../devices';
import { applyImageMaskToLuma, resampleLuma } from '../raster';
import type { BurnGridKernel } from '../raster/luma-resample';
import type { RasterImage, SceneObject, Transform, Vec2 } from '../scene';
import type { RasterMachineBounds } from './raster-bounds';

const WHITE_LUMA_BYTE = 255;
const FULL_TURN_DEG = 360;
const DEG_TO_RAD = Math.PI / 180;

export function isRotatedRaster(obj: RasterImage): boolean {
  return ((obj.transform.rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG !== 0;
}

export type RotatedRasterSampler = {
  readonly sourceLuma: Uint8Array;
  readonly obj: RasterImage;
  readonly device: DeviceProfile;
  readonly bounds: RasterMachineBounds;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Burn-grid kernel (ADR-359); omitted means 'area'. */
  readonly kernel?: BurnGridKernel;
  /** Pass-Through burns the source pixels as they are, never reduced. */
  readonly passThrough?: boolean;
};

/** A sampler whose source has been masked and, for 'area', reduced. */
export type PreparedRotatedRaster = RotatedRasterSampler & {
  readonly sampleLuma: Uint8Array;
  readonly sampleWidth: number;
  readonly sampleHeight: number;
  /** 'centre' reads the sample pixel under each cell centre; 'bilinear' blends the four around it. */
  readonly sampling: 'centre' | 'bilinear';
};

// A source only counts as denser than the burn grid past this margin, so grid
// rounding (a 1:1 image rotated 30 degrees spans 1.0012 source px per cell)
// never blurs an image that is not really being downscaled.
const REDUCTION_TOLERANCE = 1.01;

// A rotated cell has no axis-aligned source footprint to area-weight in one
// step, so the masked source is area-reduced ONCE to the burn-cell pitch along
// each source axis (ADR-359) and then sampled. A quarter turn lines the reduced
// pixels up with the burn cells exactly, so each cell reads its own area mean,
// as the upright path does. Any other angle reads the reduced grid bilinearly,
// so no reduced pixel — and no sub-cell line inside it — is skipped. A source
// no denser than the grid, Pass-Through and Threshold read the source
// untouched, byte-identical to the former centre sampler.
export function prepareRotatedRaster(
  input: RotatedRasterSampler,
  maskObject: SceneObject | null,
): PreparedRotatedRaster {
  const masked = applyImageMaskToLuma({
    image: input.obj,
    maskObject,
    luma: input.sourceLuma,
    width: input.obj.pixelWidth,
    height: input.obj.pixelHeight,
  });
  const grid = reducedSampleGrid(input);
  if (grid === null) {
    return {
      ...input,
      sampleLuma: masked,
      sampleWidth: input.obj.pixelWidth,
      sampleHeight: input.obj.pixelHeight,
      sampling: 'centre',
    };
  }
  const sampleLuma = resampleLuma(
    { luma: masked, width: input.obj.pixelWidth, height: input.obj.pixelHeight },
    grid.width,
    grid.height,
    'area',
  );
  return {
    ...input,
    sampleLuma,
    sampleWidth: grid.width,
    sampleHeight: grid.height,
    sampling: grid.quarterTurn ? 'centre' : 'bilinear',
  };
}

type ReducedGrid = {
  readonly width: number;
  readonly height: number;
  readonly quarterTurn: boolean;
};

function reducedSampleGrid(input: RotatedRasterSampler): ReducedGrid | null {
  if ((input.kernel ?? 'area') !== 'area' || input.passThrough === true) return null;
  const { obj, bounds, pixelWidth, pixelHeight } = input;
  const cellX = (bounds.maxX - bounds.minX) / pixelWidth;
  const cellY = (bounds.maxY - bounds.minY) / pixelHeight;
  const turn = quarterTurn(obj.transform.rotationDeg);
  // The burn-cell size along each SOURCE axis: exact for a quarter turn, where
  // the source axes run along the machine axes; the smaller cell otherwise.
  const swapped = turn === 1 || turn === 3;
  const nominal = Math.min(cellX, cellY);
  const cellAlongWidth = turn === null ? nominal : swapped ? cellY : cellX;
  const cellAlongHeight = turn === null ? nominal : swapped ? cellX : cellY;
  const localWidthMm = (obj.bounds.maxX - obj.bounds.minX) * Math.abs(obj.transform.scaleX);
  const localHeightMm = (obj.bounds.maxY - obj.bounds.minY) * Math.abs(obj.transform.scaleY);
  const width = reducedExtent(obj.pixelWidth, localWidthMm / cellAlongWidth);
  const height = reducedExtent(obj.pixelHeight, localHeightMm / cellAlongHeight);
  if (width === obj.pixelWidth && height === obj.pixelHeight) return null;
  return { width, height, quarterTurn: turn !== null };
}

function reducedExtent(sourcePixels: number, cells: number): number {
  if (!Number.isFinite(cells) || cells <= 0) return sourcePixels;
  const target = Math.max(1, Math.round(cells));
  return sourcePixels > target * REDUCTION_TOLERANCE ? target : sourcePixels;
}

function quarterTurn(rotationDeg: number): 1 | 2 | 3 | null {
  const turn = ((rotationDeg % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
  if (turn === 90) return 1;
  if (turn === 180) return 2;
  return turn === 270 ? 3 : null;
}

// One machine-grid row of (prepared) source luma. The machine→source mapping
// is affine, so the row walks a constant per-pixel step instead of
// transforming every pixel center individually.
export function rotatedRasterRow(input: PreparedRotatedRaster, y: number): Uint8Array {
  const toSampleX = input.sampleWidth / input.obj.pixelWidth;
  const toSampleY = input.sampleHeight / input.obj.pixelHeight;
  const start = sourcePixelPoint(input, 0, y);
  const next = sourcePixelPoint(input, 1, y);
  const walk: SampleWalk = {
    startX: start.x * toSampleX,
    startY: start.y * toSampleY,
    stepX: next.x * toSampleX - start.x * toSampleX,
    stepY: next.y * toSampleY - start.y * toSampleY,
  };
  return input.sampling === 'bilinear' ? bilinearRow(input, walk) : centreRow(input, walk);
}

type SampleWalk = {
  readonly startX: number;
  readonly startY: number;
  readonly stepX: number;
  readonly stepY: number;
};

function centreRow(input: PreparedRotatedRaster, walk: SampleWalk): Uint8Array {
  const row = new Uint8Array(input.pixelWidth);
  for (let x = 0; x < input.pixelWidth; x += 1) {
    row[x] = sampleAt(
      input,
      Math.floor(walk.startX + x * walk.stepX),
      Math.floor(walk.startY + x * walk.stepY),
    );
  }
  return row;
}

function bilinearRow(input: PreparedRotatedRaster, walk: SampleWalk): Uint8Array {
  const row = new Uint8Array(input.pixelWidth);
  for (let x = 0; x < input.pixelWidth; x += 1) {
    // Sample pixel centres sit at i + 0.5; blend the four around the point.
    const px = walk.startX + x * walk.stepX - 0.5;
    const py = walk.startY + x * walk.stepY - 0.5;
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      row[x] = WHITE_LUMA_BYTE;
      continue;
    }
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const top = sampleAt(input, x0, y0) * (1 - fx) + sampleAt(input, x0 + 1, y0) * fx;
    const bottom = sampleAt(input, x0, y0 + 1) * (1 - fx) + sampleAt(input, x0 + 1, y0 + 1) * fx;
    row[x] = Math.round(top * (1 - fy) + bottom * fy);
  }
  return row;
}

function sampleAt(input: PreparedRotatedRaster, sx: number, sy: number): number {
  // Positive-form check so NaN (e.g. zero scale) also falls to white.
  const isInside = sx >= 0 && sx < input.sampleWidth && sy >= 0 && sy < input.sampleHeight;
  return isInside
    ? (input.sampleLuma[sy * input.sampleWidth + sx] ?? WHITE_LUMA_BYTE)
    : WHITE_LUMA_BYTE;
}

export function rotatedMaskedRasterLuma(
  input: RotatedRasterSampler,
  maskObject: SceneObject | null,
): Uint8Array {
  const prepared = prepareRotatedRaster(input, maskObject);
  const out = new Uint8Array(input.pixelWidth * input.pixelHeight);
  for (let y = 0; y < input.pixelHeight; y += 1) {
    out.set(rotatedRasterRow(prepared, y), y * input.pixelWidth);
  }
  return out;
}

function sourcePixelPoint(input: RotatedRasterSampler, x: number, y: number): Vec2 {
  const { bounds, pixelWidth, pixelHeight, obj, device } = input;
  const machine = {
    x: bounds.minX + ((x + 0.5) / pixelWidth) * (bounds.maxX - bounds.minX),
    y: bounds.minY + ((y + 0.5) / pixelHeight) * (bounds.maxY - bounds.minY),
  };
  const local = invertObjectTransform(toSceneCoords(machine, device), obj.transform);
  return {
    x: ((local.x - obj.bounds.minX) / (obj.bounds.maxX - obj.bounds.minX)) * obj.pixelWidth,
    y: ((local.y - obj.bounds.minY) / (obj.bounds.maxY - obj.bounds.minY)) * obj.pixelHeight,
  };
}

// Exact inverse of core/scene/transform.ts applyTransform
// (scale → mirror → rotate → translate), so the burn stays in register with
// the canvas render, which composes the forward transform.
function invertObjectTransform(p: Vec2, t: Transform): Vec2 {
  const rad = -t.rotationDeg * DEG_TO_RAD;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  let x = dx * cos - dy * sin;
  let y = dx * sin + dy * cos;
  if (t.mirrorX) x = -x;
  if (t.mirrorY) y = -y;
  return { x: x / t.scaleX, y: y / t.scaleY };
}
