// Auto-upscale preprocessor for small, thin-featured trace sources.
//
// WHY: no tracing algorithm works well at very small scales — the official
// potrace project ships `mkbitmap` (a scale-up + filter preprocessor) for
// exactly this reason. When source strokes are under ~3px, Edge Detection
// fragments (inner/outer Canny edges collide) and the potrace-backed presets
// lose detail. Supersampling the source 2x before tracing gives every tracer
// more pixels of the same feature to lock onto; scaling the traced vectors
// back down afterwards makes the whole step invisible to the user except for
// better output.
//
// Pure-core compliant: no clock, no random, no I/O. Data in, data out.

import type { ColoredPath, Polyline, Vec2 } from '../scene';
import type { RawImageData } from './trace-image';

// Above this source area we do NOT supersample. Rationale: quadrupling an
// already-large raster costs a 2x-wide buffer for no benefit — big rasters
// overwhelmingly have >=3px features, so the thin-stroke heuristic would
// rarely fire anyway, and when it did the memory cost would not be worth it.
const MAX_UPSCALE_SOURCE_PIXELS = 1_500_000;

// Mean ink stroke half-width proxy below which a source counts as thin. For a
// long stroke of width w, inkArea / inkPerimeter ~= w/2, so 1.5 targets
// strokes thinner than ~3 px — precisely the range every tracer degrades on.
const THIN_STROKE_HALF_WIDTH_PX = 1.5;

// Ink classification cutoff on the standard BT.601 luma. A pixel is ink when
// its luma is below this value; this matches the luma cutoff used across the
// trace preprocessing chain (trace-image.ts).
const INK_LUMA_CUTOFF = 128;

const UPSCALE_FACTOR = 2;

// True iff the source is small AND thin-featured, i.e. worth supersampling.
export function shouldAutoUpscale(image: RawImageData): boolean {
  if (image.width * image.height > MAX_UPSCALE_SOURCE_PIXELS) return false;
  const ink = inkMask(image);
  const area = countInk(ink);
  if (area === 0) return false;
  const perimeter = countInkPerimeter(ink, image.width, image.height);
  if (perimeter === 0) return false;
  return area / perimeter < THIN_STROKE_HALF_WIDTH_PX;
}

// 2x bilinear upscale of the RGBA buffer. Bilinear (not nearest) preserves the
// anti-aliasing gradients the tracers exploit; nearest would create hard
// staircases that read as jagged geometry. Each output pixel samples the source
// at ((x+0.5)/factor - 0.5, (y+0.5)/factor - 0.5) with edge clamping.
export function upscaleDouble(image: RawImageData): RawImageData {
  const outWidth = image.width * UPSCALE_FACTOR;
  const outHeight = image.height * UPSCALE_FACTOR;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let oy = 0; oy < outHeight; oy += 1) {
    const sy = (oy + 0.5) / UPSCALE_FACTOR - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const cy0 = clampCoord(y0, image.height);
    const cy1 = clampCoord(y0 + 1, image.height);
    for (let ox = 0; ox < outWidth; ox += 1) {
      const sx = (ox + 0.5) / UPSCALE_FACTOR - 0.5;
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const cx0 = clampCoord(x0, image.width);
      const cx1 = clampCoord(x0 + 1, image.width);
      const dst = (oy * outWidth + ox) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = lerp(sample(image, cx0, cy0, c), sample(image, cx1, cy0, c), fx);
        const bottom = lerp(sample(image, cx0, cy1, c), sample(image, cx1, cy1, c), fx);
        data[dst + c] = Math.round(lerp(top, bottom, fy));
      }
    }
  }
  return { width: outWidth, height: outHeight, data };
}

// Scale traced vectors back to source coordinates by dividing every point by
// the upscale factor. Pure coordinate transform — closed flags and colours are
// carried through untouched.
export function downscaleTracedPaths(
  paths: ReadonlyArray<ColoredPath>,
  factor: number,
): ColoredPath[] {
  return paths.map((path) => ({
    color: path.color,
    polylines: path.polylines.map((pl) => scalePolyline(pl, factor)),
  }));
}

function scalePolyline(polyline: Polyline, factor: number): Polyline {
  const points: Vec2[] = polyline.points.map((p) => ({ x: p.x / factor, y: p.y / factor }));
  return { points, closed: polyline.closed };
}

// Monochrome ink view: 1 = ink (luma < cutoff), 0 = paper. One byte per pixel.
function inkMask(image: RawImageData): Uint8Array {
  const mask = new Uint8Array(image.width * image.height);
  for (let i = 0; i < mask.length; i += 1) {
    const o = i * 4;
    const luma =
      0.299 * (image.data[o] ?? 255) +
      0.587 * (image.data[o + 1] ?? 255) +
      0.114 * (image.data[o + 2] ?? 255);
    mask[i] = luma < INK_LUMA_CUTOFF ? 1 : 0;
  }
  return mask;
}

function countInk(mask: Uint8Array): number {
  let count = 0;
  for (const value of mask) if (value === 1) count += 1;
  return count;
}

// Count ink pixels with at least one non-ink 4-neighbour. The image border
// counts as non-ink, so ink touching an edge is on the perimeter.
function countInkPerimeter(mask: Uint8Array, width: number, height: number): number {
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      if (hasNonInkNeighbour(mask, width, height, x, y)) count += 1;
    }
  }
  return count;
}

function hasNonInkNeighbour(
  mask: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): boolean {
  return (
    isNonInk(mask, width, height, x - 1, y) ||
    isNonInk(mask, width, height, x + 1, y) ||
    isNonInk(mask, width, height, x, y - 1) ||
    isNonInk(mask, width, height, x, y + 1)
  );
}

// Out-of-bounds (border) counts as non-ink.
function isNonInk(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) return true;
  return mask[y * width + x] !== 1;
}

function sample(image: RawImageData, x: number, y: number, channel: number): number {
  return image.data[(y * image.width + x) * 4 + channel] ?? 0;
}

function clampCoord(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
