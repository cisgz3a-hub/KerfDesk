// Unsharp mask at engraving resolution (ADR-671).
//
// Area resampling to the burn grid (ADR-359) averages every burn cell over the
// source pixels it covers, which softens eyes, lashes and hair again after any
// sharpening done on the source in Image Studio. This pass sharpens the luma
// the dither actually consumes:
//
//   out = v + amount * (v - gaussian(v)),  rounded once and clamped to a byte
//
// The Gaussian is separable, reads clamped edges (a flat border stays flat),
// and its sigma ("radius", as in Image Studio and Photoshop) is measured in
// burn cells. The pass runs one output row at a time over a window of
// horizontally blurred rows, so the streamed compile keeps O(width) memory and
// the materialized compile, which runs the very same row function, is
// byte-identical to it.

const BYTE_MAX = 255;
const PERCENT = 100;
// Beyond three sigmas the Gaussian tail is visually zero (gaussian-blur.ts).
const KERNEL_SIGMAS = 3;

/** Amount in percent of the difference added back; 0 is off. */
export const SHARPEN_AMOUNT_MAX = 500;
/** Gaussian sigma in burn cells. */
export const SHARPEN_RADIUS_MIN = 0.5;
export const SHARPEN_RADIUS_MAX = 3;
export const DEFAULT_SHARPEN_RADIUS = 1;
// A sigma resolved onto a grid other than the burn grid (a rotated image's
// source) never gets a kernel wider than this, so the work stays bounded.
const MAX_GRID_SIGMA = 12;

export type LumaSharpenSettings = {
  readonly sharpenAmount?: number;
  readonly sharpenRadius?: number;
};

/** Sharpening resolved for the burn grid: amount in percent, sigma in cells. */
export type BurnGridSharpen = {
  readonly amountPercent: number;
  readonly radiusCells: number;
};

/** Gaussian sigma on the grid actually being sharpened, per axis. */
export type GridSharpen = {
  readonly amountPercent: number;
  readonly sigmaX: number;
  readonly sigmaY: number;
};

/**
 * The sharpening an image asks for, or null when it is off. Absent, zero or
 * non-finite amounts are off, so existing projects compile byte-identically;
 * Pass-through burns source pixels untouched and is never sharpened.
 */
export function burnGridSharpen(
  settings: LumaSharpenSettings,
  passThrough: boolean,
): BurnGridSharpen | null {
  const amount = settings.sharpenAmount ?? 0;
  if (passThrough || !Number.isFinite(amount) || amount <= 0) return null;
  const radius = settings.sharpenRadius ?? DEFAULT_SHARPEN_RADIUS;
  return {
    amountPercent: Math.min(SHARPEN_AMOUNT_MAX, amount),
    radiusCells: Number.isFinite(radius)
      ? Math.max(SHARPEN_RADIUS_MIN, Math.min(SHARPEN_RADIUS_MAX, radius))
      : DEFAULT_SHARPEN_RADIUS,
  };
}

/**
 * The burn-cell radius expressed on another grid whose pixels are
 * `cellsPerPixelX` x `cellsPerPixelY` burn cells: a reduced preview, or a
 * rotated image's source, so the radius stays the same size in millimetres.
 */
export function gridSharpen(
  sharpen: BurnGridSharpen,
  cellsPerPixelX = 1,
  cellsPerPixelY = 1,
): GridSharpen {
  return {
    amountPercent: sharpen.amountPercent,
    sigmaX: gridSigma(sharpen.radiusCells, cellsPerPixelX),
    sigmaY: gridSigma(sharpen.radiusCells, cellsPerPixelY),
  };
}

function gridSigma(radiusCells: number, cellsPerPixel: number): number {
  if (!Number.isFinite(cellsPerPixel) || cellsPerPixel <= 0) return radiusCells;
  return Math.min(MAX_GRID_SIGMA, radiusCells / cellsPerPixel);
}

export function sharpenLuma(
  luma: Uint8Array,
  width: number,
  height: number,
  sharpen: GridSharpen,
): Uint8Array {
  const rowAt = createSharpenedRowSource(
    (y) => luma.subarray(y * width, (y + 1) * width),
    width,
    height,
    sharpen,
  );
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) out.set(rowAt(y), y * width);
  return out;
}

type BlurredRow = {
  readonly values: Uint8Array;
  readonly horizontal: Float64Array;
};

/**
 * Row-at-a-time unsharp mask over `rowAt`. Each output row depends only on
 * the input rows within the vertical kernel, so any access order gives the
 * same bytes; the cache only spares recomputing a neighbour's row.
 */
export function createSharpenedRowSource(
  rowAt: (y: number) => Uint8Array,
  width: number,
  height: number,
  sharpen: GridSharpen,
): (y: number) => Uint8Array {
  const kernelX = gaussianKernel(sharpen.sigmaX);
  const kernelY = gaussianKernel(sharpen.sigmaY);
  const halfY = (kernelY.length - 1) / 2;
  const amount = sharpen.amountPercent / PERCENT;
  const lastRow = Math.max(0, height - 1);
  const cached = new Map<number, BlurredRow>();
  const capacity = 2 * halfY + 2;
  const blurredRow = (row: number, around: number): BlurredRow => {
    const hit = cached.get(row);
    if (hit !== undefined) return hit;
    const values = rowAt(row);
    const entry = { values, horizontal: horizontalBlur(values, width, kernelX) };
    if (cached.size >= capacity) cached.delete(farthestRow(cached, around));
    cached.set(row, entry);
    return entry;
  };
  return (targetY) => {
    const y = Math.min(lastRow, Math.max(0, Math.floor(targetY)));
    const blurred = new Float64Array(width);
    for (let k = -halfY; k <= halfY; k += 1) {
      const horizontal = blurredRow(Math.min(lastRow, Math.max(0, y + k)), y).horizontal;
      const weight = kernelY[k + halfY] ?? 0;
      for (let x = 0; x < width; x += 1) {
        blurred[x] = (blurred[x] ?? 0) + (horizontal[x] ?? 0) * weight;
      }
    }
    const values = blurredRow(y, y).values;
    const out = new Uint8Array(width);
    for (let x = 0; x < width; x += 1) {
      const value = values[x] ?? BYTE_MAX;
      const sharpened = Math.round(value + amount * (value - (blurred[x] ?? 0)));
      out[x] = sharpened > 0 ? Math.min(BYTE_MAX, sharpened) : 0;
    }
    return out;
  };
}

// The cached row the current window is least likely to need again, whichever
// direction the caller walks (a flipped machine Y walks the grid upwards).
function farthestRow(cached: ReadonlyMap<number, BlurredRow>, around: number): number {
  let farthest = around;
  let distance = -1;
  for (const row of cached.keys()) {
    if (Math.abs(row - around) <= distance) continue;
    farthest = row;
    distance = Math.abs(row - around);
  }
  return farthest;
}

function horizontalBlur(values: Uint8Array, width: number, kernel: Float64Array): Float64Array {
  const half = (kernel.length - 1) / 2;
  const last = Math.max(0, width - 1);
  const out = new Float64Array(width);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -half; k <= half; k += 1) {
      const sx = Math.min(last, Math.max(0, x + k));
      sum += (values[sx] ?? BYTE_MAX) * (kernel[k + half] ?? 0);
    }
    out[x] = sum;
  }
  return out;
}

function gaussianKernel(sigma: number): Float64Array {
  const half = Math.max(1, Math.ceil(sigma * KERNEL_SIGMAS));
  const kernel = new Float64Array(2 * half + 1);
  let sum = 0;
  for (let i = -half; i <= half; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + half] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] = (kernel[i] ?? 0) / sum;
  return kernel;
}
