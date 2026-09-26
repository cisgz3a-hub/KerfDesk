// A top-down picture of the bed from one camera frame (ADR-440): every output
// pixel is a bed point at the chosen surface height, and the camera model says
// exactly which camera pixel sees it. Trace from camera and Capture image use
// it, so traced vectors land where the material really is at any thickness.
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
import { rodriguesToMatrix } from '../rodrigues';

export type BedImageOptions = {
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
  readonly pixelsPerMm: number;
  /** Height of the surface being pictured above the bed, mm. */
  readonly surfaceHeightMm: number;
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
  const width = Math.round(options.bedWidthMm * options.pixelsPerMm);
  const height = Math.round(options.bedHeightMm * options.pixelsPerMm);
  if (!(width > 0 && height > 0)) return null;
  const grid = projectedGrid(lens, pose, width, height, options);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = interpolatedSource(grid, x, y);
      if (source !== null) writeBilinear(data, (y * width + x) * 4, frame, source.x, source.y);
    }
  }
  return { data, width, height };
}

type ProjectedGrid = {
  readonly columns: number;
  readonly rows: number;
  /** Camera pixel per grid node, x then y; NaN where the camera can't see. */
  readonly pixels: Float64Array;
};

function projectedGrid(
  lens: LensModel,
  pose: CameraPose,
  width: number,
  height: number,
  options: BedImageOptions,
): ProjectedGrid {
  const columns = Math.ceil((width - 1) / GRID_STEP) + 1;
  const rows = Math.ceil((height - 1) / GRID_STEP) + 1;
  const pixels = new Float64Array(columns * rows * 2);
  const rotation = rodriguesToMatrix(pose.rvec);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Output pixel centres sit at (index + 0.5) / pixelsPerMm on the bed.
      const bedX = (column * GRID_STEP + 0.5) / options.pixelsPerMm;
      const bedY = (row * GRID_STEP + 0.5) / options.pixelsPerMm;
      const world = bedPoint(bedX, bedY, options.surfaceHeightMm);
      const pixel = projectWorldPoint(lens, pose, world, rotation);
      const at = (row * columns + column) * 2;
      pixels[at] = pixel?.x ?? Number.NaN;
      pixels[at + 1] = pixel?.y ?? Number.NaN;
    }
  }
  return { columns, rows, pixels };
}

function interpolatedSource(grid: ProjectedGrid, x: number, y: number): Vec2 | null {
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
