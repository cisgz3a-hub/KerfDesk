// The arrays behind a crack field's readers, for passes over every pixel
// (tracer speed round, 2026-11-05).
//
// lumaAt and thresholdAt are closures, and a whole-grid pass that calls them
// per pixel spends most of its time in the calls and their bounds checks. The
// fields that read a plain luma plane, or cut against a box mean over its
// integral image, register those arrays under the reader itself, so a copy of
// the field that keeps the reader ({ ...field, crackCrossingAt }) keeps them,
// and one that replaces the reader cannot reach them. A pass reads the arrays
// where they exist and calls the reader otherwise; inside the grid both give
// the same value.
//
// Pure core, deterministic.

import type { CrackSubPixelField } from './saddle-connectivity';

/** lumaAt(x, y) === luma[y * width + x] at every pixel of the grid. */
export type LumaPlane = {
  readonly width: number;
  readonly height: number;
  readonly luma: Uint8Array;
};

/** thresholdAt(x, y) at a pixel of the grid: the box mean of `radius` around
 *  it over the summed-area table `integral` ((width + 1) x (height + 1)),
 *  less `bias` (sketch-window.ts localMean). */
export type BoxThreshold = {
  readonly width: number;
  readonly height: number;
  readonly integral: Float64Array;
  readonly radius: number;
  readonly bias: number;
};

type Reader = (x: number, y: number) => number;

const lumaPlanes = new WeakMap<Reader, LumaPlane>();
const boxThresholds = new WeakMap<Reader, BoxThreshold>();
let lookups = true;

/** Run `trace` with every pass taking the per-pixel readers, so a test can
 *  hold the array passes to the readers' values. */
export async function withoutFieldPlanes<T>(trace: () => Promise<T>): Promise<T> {
  lookups = false;
  try {
    return await trace();
  } finally {
    lookups = true;
  }
}

export function registerLumaPlane(lumaAt: Reader, plane: LumaPlane): Reader {
  lumaPlanes.set(lumaAt, plane);
  return lumaAt;
}

export function registerBoxThreshold(thresholdAt: Reader, box: BoxThreshold): Reader {
  boxThresholds.set(thresholdAt, box);
  return thresholdAt;
}

/** The luma array the field reads on a width x height grid, if it is one. */
export function fieldLuma(
  field: Pick<CrackSubPixelField, 'lumaAt'>,
  width: number,
  height: number,
): Uint8Array | null {
  const plane = lookups ? lumaPlanes.get(field.lumaAt) : undefined;
  return plane !== undefined && plane.width === width && plane.height === height
    ? plane.luma
    : null;
}

/** The field's box-mean cut on a width x height grid, if it is one. */
export function fieldBoxThreshold(
  field: Pick<CrackSubPixelField, 'thresholdAt'>,
  width: number,
  height: number,
): BoxThreshold | null {
  const box = lookups ? boxThresholds.get(field.thresholdAt) : undefined;
  return box !== undefined && box.width === width && box.height === height ? box : null;
}
