// Synthetic anti-aliased fixtures and ring-radius metrics shared by the edge
// precision tests (ADR-453 / ADR-456). Every fixture is painted from exact
// area coverage (8x8 supersampling), so the true edge is known analytically.

import type { Polyline } from '../scene';
import type { RawImageData } from './trace-image';

const SUPERSAMPLES = 8;

export type Disc = { readonly cx: number; readonly cy: number; readonly r: number };

/** Fraction of pixel (x, y) inside the disc. */
export function discCoverage(x: number, y: number, disc: Disc): number {
  let inside = 0;
  for (let sy = 0; sy < SUPERSAMPLES; sy += 1) {
    for (let sx = 0; sx < SUPERSAMPLES; sx += 1) {
      const px = x + (sx + 0.5) / SUPERSAMPLES - disc.cx;
      const py = y + (sy + 0.5) / SUPERSAMPLES - disc.cy;
      if (px * px + py * py <= disc.r * disc.r) inside += 1;
    }
  }
  return inside / SUPERSAMPLES ** 2;
}

/** Grey image from a per-pixel luma function (opaque RGBA). */
export function lumaImage(size: number, lumaOf: (x: number, y: number) => number): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const v = Math.round(lumaOf(x, y));
      data.set([v, v, v, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

/** Black ink whose alpha carries the disc coverage, on transparent paper. */
export function alphaDiscImage(size: number, disc: Disc): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      data.set([0, 0, 0, Math.round(255 * discCoverage(x, y, disc))], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

export type RadiusStats = { readonly bias: number; readonly rms: number; readonly samples: number };

/** Signed radial error of every traced vertex and segment midpoint that lies
 *  within `band` px of the expected radius `r` about (cx, cy). */
export function radiusStats(
  polylines: ReadonlyArray<Polyline>,
  disc: Disc,
  band = 2,
  midpoints = false,
): RadiusStats {
  let sum = 0;
  let sumSq = 0;
  let samples = 0;
  const add = (x: number, y: number): void => {
    const error = Math.hypot(x - disc.cx, y - disc.cy) - disc.r;
    if (Math.abs(error) > band) return;
    sum += error;
    sumSq += error * error;
    samples += 1;
  };
  for (const polyline of polylines) {
    const points = polyline.points;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a === undefined || b === undefined) continue;
      add(a.x, a.y);
      if (midpoints) add((a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  }
  return samples === 0
    ? { bias: Number.NaN, rms: Number.NaN, samples }
    : { bias: sum / samples, rms: Math.sqrt(sumSq / samples), samples };
}
