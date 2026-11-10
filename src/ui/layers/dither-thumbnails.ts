// Thumbnails for the Dither picker: one shared dark-to-light ramp run through
// the real dither() for each mode, so every swatch shows what that mode burns.
// Binary modes become one SVG path of burned runs; Grayscale stays a smooth
// ramp of opacity stops. Each mode is computed once and cached.

import { dither } from '../../core/raster';
import type { DitherAlgorithm } from '../../core/scene';
import { roundToThousandth } from '../../core/util/rounding';

export const DITHER_THUMBNAIL_COLUMNS = 22;
export const DITHER_THUMBNAIL_ROWS = 11;

const S_MAX = 255;

export type DitherThumbnail =
  | { readonly kind: 'dots'; readonly path: string }
  | { readonly kind: 'ramp'; readonly stops: ReadonlyArray<RampStop> };

export type RampStop = { readonly offset: number; readonly opacity: number };

const thumbnails = new Map<DitherAlgorithm, DitherThumbnail>();
let rampLuma: Uint8Array | null = null;

export function ditherThumbnail(algorithm: DitherAlgorithm): DitherThumbnail {
  const cached = thumbnails.get(algorithm);
  if (cached !== undefined) return cached;
  const power = dither(
    { luma: thumbnailRampLuma(), width: DITHER_THUMBNAIL_COLUMNS, height: DITHER_THUMBNAIL_ROWS },
    { algorithm, sMax: S_MAX },
  );
  const thumbnail: DitherThumbnail =
    algorithm === 'grayscale'
      ? { kind: 'ramp', stops: rampStops(power) }
      : { kind: 'dots', path: burnedRunsPath(power) };
  thumbnails.set(algorithm, thumbnail);
  return thumbnail;
}

/** The shared source: near-black on the left to near-white on the right. */
export function thumbnailRampLuma(): Uint8Array {
  if (rampLuma !== null) return rampLuma;
  const luma = new Uint8Array(DITHER_THUMBNAIL_COLUMNS * DITHER_THUMBNAIL_ROWS);
  for (let y = 0; y < DITHER_THUMBNAIL_ROWS; y += 1) {
    for (let x = 0; x < DITHER_THUMBNAIL_COLUMNS; x += 1) {
      luma[y * DITHER_THUMBNAIL_COLUMNS + x] = Math.round(
        ((x + 0.5) / DITHER_THUMBNAIL_COLUMNS) * 255,
      );
    }
  }
  rampLuma = luma;
  return luma;
}

// One closed rectangle per horizontal run of burned pixels, in pixel units.
function burnedRunsPath(power: Float64Array): string {
  const parts: string[] = [];
  for (let y = 0; y < DITHER_THUMBNAIL_ROWS; y += 1) {
    let x = 0;
    while (x < DITHER_THUMBNAIL_COLUMNS) {
      if (!burned(power, x, y)) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < DITHER_THUMBNAIL_COLUMNS && burned(power, x, y)) x += 1;
      parts.push(`M${start} ${y}h${x - start}v1H${start}z`);
    }
  }
  return parts.join('');
}

function burned(power: Float64Array, x: number, y: number): boolean {
  return (power[y * DITHER_THUMBNAIL_COLUMNS + x] ?? 0) > 0;
}

// Grayscale varies power along the ramp only, so the first row carries it.
function rampStops(power: Float64Array): ReadonlyArray<RampStop> {
  return Array.from({ length: DITHER_THUMBNAIL_COLUMNS }, (_, x) => ({
    offset: roundToThousandth((x + 0.5) / DITHER_THUMBNAIL_COLUMNS),
    opacity: roundToThousandth((power[x] ?? 0) / S_MAX),
  }));
}
