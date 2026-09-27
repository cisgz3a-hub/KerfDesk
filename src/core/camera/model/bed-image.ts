// A top-down picture of the bed from one camera frame (ADR-440): every output
// pixel is a bed point at its surface height, and the camera model says
// exactly which camera pixel sees it. Trace from camera and the calibration
// review use it, so traced vectors land where the material really is at any
// thickness. Inside a height area (ADR-441 Amendment 2) a pixel is read at
// that area's height, the highest area winning where they overlap.
// Output→input sampling, bilinear; bed points the camera cannot see stay
// transparent. Pure core.

import { writeBilinear, type RgbaImage } from '../rgba-image';
import {
  bedPoint,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
  type Vec2,
} from './camera-model';
import type { BedArea } from './camera-model-accuracy';
import type { SurfaceHeightArea } from './height-areas';
import type { Mat3 } from '../homography';
import { rodriguesToMatrix } from '../rodrigues';

export type BedImageOptions = {
  /** The part of the bed pictured, mm; output pixel (0, 0) is its top-left corner. */
  readonly region: BedArea;
  readonly pixelsPerMm: number;
  /** Height of the surface being pictured above the bed, mm, outside every height area. */
  readonly surfaceHeightMm: number;
  readonly heightAreas?: ReadonlyArray<SurfaceHeightArea>;
};

// The camera pixel of every GRID_STEP-th output pixel is projected exactly and
// the ones between are interpolated: the mapping is smooth, so the difference
// is far below a pixel while the warp gets ~16× cheaper.
const GRID_STEP = 4;

/** `frame` resampled top-down onto the bed, or null for an empty output. */
export function warpFrameToBedImage(
  frame: RgbaImage,
  lens: LensModel,
  pose: CameraPose,
  options: BedImageOptions,
): RgbaImage | null {
  const width = Math.round(options.region.width * options.pixelsPerMm);
  const height = Math.round(options.region.height * options.pixelsPerMm);
  if (!(width > 0 && height > 0)) return null;
  const projector: Projector = {
    lens,
    pose,
    rotation: rodriguesToMatrix(pose.rvec),
    region: options.region,
    pixelsPerMm: options.pixelsPerMm,
  };
  const whole: PixelBox = { x0: 0, y0: 0, x1: width - 1, y1: height - 1 };
  const base = projectedGrid(projector, whole, options.surfaceHeightMm);
  const layers = heightLayers(projector, options.heightAreas ?? [], whole);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const grid = layers.find((layer) => boxContains(layer.box, x, y)) ?? base;
      const source = interpolatedSource(grid, x, y);
      if (source !== null) writeBilinear(data, (y * width + x) * 4, frame, source.x, source.y);
    }
  }
  return { data, width, height };
}

type Projector = {
  readonly lens: LensModel;
  readonly pose: CameraPose;
  readonly rotation: Mat3;
  readonly region: BedArea;
  readonly pixelsPerMm: number;
};

/** Output pixels x0..x1 by y0..y1, inclusive. */
type PixelBox = {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
};

type ProjectedGrid = {
  readonly box: PixelBox;
  readonly columns: number;
  readonly rows: number;
  /** Camera pixel per grid node, x then y; NaN where the camera can't see. */
  readonly pixels: Float64Array;
};

// Output pixel centres sit at region corner + (index + 0.5) / pixelsPerMm.
function bedX(projector: Projector, x: number): number {
  return projector.region.x + (x + 0.5) / projector.pixelsPerMm;
}

function bedY(projector: Projector, y: number): number {
  return projector.region.y + (y + 0.5) / projector.pixelsPerMm;
}

/**
 * One grid per area, highest first, each covering only the output pixels whose
 * centres lie in the area, so the first layer that holds a pixel is the one
 * surfaceHeightAt would pick for it.
 */
function heightLayers(
  projector: Projector,
  areas: ReadonlyArray<SurfaceHeightArea>,
  whole: PixelBox,
): ReadonlyArray<ProjectedGrid> {
  const highestFirst = [...areas].sort((a, b) => b.surfaceHeightMm - a.surfaceHeightMm);
  const layers: ProjectedGrid[] = [];
  for (const area of highestFirst) {
    const box = pixelsInside(projector, area, whole);
    if (box !== null) layers.push(projectedGrid(projector, box, area.surfaceHeightMm));
  }
  return layers;
}

// Pixel x holds a centre inside [area.x, area.x + width] when
// area.x <= bedX(x) <= area.x + width, solved for x.
function pixelsInside(projector: Projector, area: BedArea, whole: PixelBox): PixelBox | null {
  const ppm = projector.pixelsPerMm;
  const x0 = Math.max(whole.x0, Math.ceil((area.x - projector.region.x) * ppm - 0.5));
  const x1 = Math.min(whole.x1, Math.floor((area.x + area.width - projector.region.x) * ppm - 0.5));
  const y0 = Math.max(whole.y0, Math.ceil((area.y - projector.region.y) * ppm - 0.5));
  const y1 = Math.min(
    whole.y1,
    Math.floor((area.y + area.height - projector.region.y) * ppm - 0.5),
  );
  return x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1 } : null;
}

function boxContains(box: PixelBox, x: number, y: number): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1;
}

function projectedGrid(projector: Projector, box: PixelBox, heightMm: number): ProjectedGrid {
  const columns = Math.ceil((box.x1 - box.x0) / GRID_STEP) + 1;
  const rows = Math.ceil((box.y1 - box.y0) / GRID_STEP) + 1;
  const pixels = new Float64Array(columns * rows * 2);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const world = bedPoint(
        bedX(projector, box.x0 + column * GRID_STEP),
        bedY(projector, box.y0 + row * GRID_STEP),
        heightMm,
      );
      const pixel = projectWorldPoint(projector.lens, projector.pose, world, projector.rotation);
      const at = (row * columns + column) * 2;
      pixels[at] = pixel?.x ?? Number.NaN;
      pixels[at + 1] = pixel?.y ?? Number.NaN;
    }
  }
  return { box, columns, rows, pixels };
}

function interpolatedSource(grid: ProjectedGrid, outX: number, outY: number): Vec2 | null {
  const x = outX - grid.box.x0;
  const y = outY - grid.box.y0;
  const column = Math.min(Math.floor(x / GRID_STEP), grid.columns - 2);
  const row = Math.min(Math.floor(y / GRID_STEP), grid.rows - 2);
  const tx = x / GRID_STEP - Math.max(column, 0);
  const ty = y / GRID_STEP - Math.max(row, 0);
  const c0 = Math.max(column, 0);
  const r0 = Math.max(row, 0);
  const c1 = Math.min(c0 + 1, grid.columns - 1);
  const r1 = Math.min(r0 + 1, grid.rows - 1);
  const sx = blend(grid, c0, r0, c1, r1, tx, ty, 0);
  const sy = blend(grid, c0, r0, c1, r1, tx, ty, 1);
  return Number.isFinite(sx) && Number.isFinite(sy) ? { x: sx, y: sy } : null;
}

function blend(
  grid: ProjectedGrid,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  tx: number,
  ty: number,
  axis: 0 | 1,
): number {
  const at = (c: number, r: number): number =>
    grid.pixels[(r * grid.columns + c) * 2 + axis] ?? Number.NaN;
  const top = at(c0, r0) + (at(c1, r0) - at(c0, r0)) * tx;
  const bottom = at(c0, r1) + (at(c1, r1) - at(c0, r1)) * tx;
  return top + (bottom - top) * ty;
}
