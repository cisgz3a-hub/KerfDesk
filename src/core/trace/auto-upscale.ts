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

import {
  transformCurveSubpathUniform,
  type ColoredPath,
  type CurveSubpath,
  type Polyline,
  type Vec2,
} from '../scene';
import type { RawImageData } from './trace-image';

// Above this source area we do NOT supersample. Rationale: quadrupling an
// already-large raster costs a 2x-wide buffer for no benefit — big rasters
// overwhelmingly have >=3px features, so the thin-stroke heuristic would
// rarely fire anyway, and when it did the memory cost would not be worth it.
// Exported for the region-enhance path, which budgets its crop by the same cap.
export const MAX_UPSCALE_SOURCE_PIXELS = 1_500_000;

// Contour supersampling has a separately measured working-raster budget. The
// 1024² acceptance source needs 2× sampling for apex fidelity (4.19M pixels),
// while a 1200² source would reach 5.76M and is refused before allocation.
export const MAX_CONTOUR_SUPERSAMPLE_PIXELS = 4_500_000;

// Mean ink stroke half-width proxy below which a source counts as thin. For a
// long stroke of width w, inkArea / inkPerimeter ~= w/2, so 1.5 targets
// strokes thinner than ~3 px — precisely the range every tracer degrades on.
const THIN_STROKE_HALF_WIDTH_PX = 1.5;

// Longest source edge below which a source counts as SMALL. Small letters have
// small-radius curves that quantize into visible polygonal chords (the user's
// faceted E/B at 40-60px) even when their strokes are a comfortable ~6px — so
// the thin-stroke gate above never fires. Tuned to 100px from the facet harness
// (_small-letter-facet.test.ts): 40-60px letters (longest edge <=~80px, badly
// faceted natively at 5-10%) upscale, while ~90px letters (longest edge ~110px)
// already trace smooth (<2%) and are EXCLUDED — supersampling them perturbs the
// Canny/DP fit and regresses some glyphs. Well below the 1024px arch logo, so
// large art is untouched. NOTE: this is a max-dimension gate, so a very wide
// banner of small text (>100px wide) is not caught; single/short small imports,
// the reported case, are.
const SMALL_SOURCE_EDGE_PX = 100;

// Effective working edge we aim the supersample at. A curve facets while its
// radius spans only a few pixels; lifting the longest edge toward ~180px puts a
// small letter's bowls into the smooth regime. The factor is the smallest
// integer reaching this (capped at 3): at 4x+ the fixed Canny blur sigma
// becomes proportionally too small and RE-introduces staircasing, so more is
// worse — verified in the facet sweep.
const SMALL_SOURCE_TARGET_EDGE_PX = 180;

// Ink classification cutoff on the standard BT.601 luma. A pixel is ink when
// its luma is below this value; this matches the luma cutoff used across the
// trace preprocessing chain (trace-image.ts).
const INK_LUMA_CUTOFF = 128;

// Supersample factor bounds. 2x is the floor (the original thin-stroke policy);
// 3x is the ceiling — enough to smooth the smallest letters without an
// unbounded buffer or exploding downstream point counts.
const MIN_UPSCALE_FACTOR = 2;
const MAX_UPSCALE_FACTOR = 3;

// Fixed factor for the original THIN-STROKE trigger. Kept at 2x — the historical
// value the thin-stroke fixtures/tests were tuned to (e.g. a 3px centerline bar
// wobbles at 3x). Only the newer small-source trigger uses the adaptive factor.
export const THIN_STROKE_UPSCALE_FACTOR = MIN_UPSCALE_FACTOR;

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

// True iff the source is SMALL (longest edge below the threshold) and carries
// ink, independent of stroke thickness. This is the companion trigger to
// shouldAutoUpscale: it catches thick-stroked-but-tiny letters whose curves
// facet purely because their radius is a handful of pixels. Gated to
// smooth-wanting presets by the caller (see trace-to-paths.ts) so Sharp's
// pixel-art notches are never anti-aliased away.
export function shouldUpscaleSmallSource(image: RawImageData): boolean {
  if (image.width * image.height > MAX_UPSCALE_SOURCE_PIXELS) return false;
  if (Math.max(image.width, image.height) >= SMALL_SOURCE_EDGE_PX) return false;
  return countInk(inkMask(image)) > 0;
}

// Adaptive supersample factor for the SMALL-SOURCE trigger. Picks the smallest
// factor in [2, 3] that lifts the longest source edge to
// ~SMALL_SOURCE_TARGET_EDGE_PX, then backs off if that would push the buffer
// past the pixel cap. (The thin-stroke trigger stays at the fixed historical 2x
// — see THIN_STROKE_UPSCALE_FACTOR — so this is only used for small sources.)
export function computeUpscaleFactor(image: RawImageData): number {
  const maxDim = Math.max(1, image.width, image.height);
  const ideal = Math.ceil(SMALL_SOURCE_TARGET_EDGE_PX / maxDim);
  let factor = Math.max(MIN_UPSCALE_FACTOR, Math.min(MAX_UPSCALE_FACTOR, ideal));
  while (factor > MIN_UPSCALE_FACTOR && !fitsUpscalePixelBudget(image, factor)) {
    factor -= 1;
  }
  return factor;
}

/** True when the WORKING raster, after scaling, stays inside the trace budget. */
export function fitsUpscalePixelBudget(
  image: Pick<RawImageData, 'width' | 'height'>,
  factor: number,
): boolean {
  return (
    isValidUpscaleFactor(factor) &&
    image.width * image.height * factor * factor <= MAX_UPSCALE_SOURCE_PIXELS
  );
}

export function fitsContourSupersampleBudget(
  image: Pick<RawImageData, 'width' | 'height'>,
  factor: number,
): boolean {
  return (
    isValidUpscaleFactor(factor) &&
    image.width * image.height * factor * factor <= MAX_CONTOUR_SUPERSAMPLE_PIXELS
  );
}

// The factor contract for both supersample helpers: a finite integer >= 1.
// Internal callers only ever pass 2 or 3; a non-integer / non-finite / <1
// factor would mint zero-length or non-finite-dimension buffers (upscale) or
// non-finite coordinates (downscale), so we fail closed on it instead.
function isValidUpscaleFactor(factor: number): boolean {
  return Number.isInteger(factor) && factor >= 1;
}

// Bilinear upscale of the RGBA buffer by an integer factor. Bilinear (not
// nearest) preserves the anti-aliasing gradients the tracers exploit; nearest
// would create hard staircases that read as jagged geometry. Each output pixel
// samples the source at ((x+0.5)/factor - 0.5, ...) with edge clamping.
//
// Fails closed on an invalid factor by returning the image unchanged
// (identity, factor-1 semantics).
export function upscaleBy(image: RawImageData, factor: number): RawImageData {
  if (!isValidUpscaleFactor(factor)) return image;
  const outWidth = image.width * factor;
  const outHeight = image.height * factor;
  const data = new Uint8ClampedArray(outWidth * outHeight * 4);
  const src = image.data;
  // Every output column samples the same two source columns with the same
  // weight in every row, so the column taps are computed once, not per pixel.
  const left = new Int32Array(outWidth);
  const right = new Int32Array(outWidth);
  const weight = new Float64Array(outWidth);
  for (let ox = 0; ox < outWidth; ox += 1) {
    const sx = (ox + 0.5) / factor - 0.5;
    const x0 = Math.floor(sx);
    weight[ox] = sx - x0;
    left[ox] = clampCoord(x0, image.width) * 4;
    right[ox] = clampCoord(x0 + 1, image.width) * 4;
  }
  const rowBytes = image.width * 4;
  for (let oy = 0; oy < outHeight; oy += 1) {
    const sy = (oy + 0.5) / factor - 0.5;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const row0 = clampCoord(y0, image.height) * rowBytes;
    const row1 = clampCoord(y0 + 1, image.height) * rowBytes;
    let dst = oy * outWidth * 4;
    for (let ox = 0; ox < outWidth; ox += 1) {
      const fx = weight[ox] as number;
      const l = left[ox] as number;
      const r = right[ox] as number;
      for (let c = 0; c < 4; c += 1) {
        const top = lerp(src[row0 + l + c] ?? 0, src[row0 + r + c] ?? 0, fx);
        const bottom = lerp(src[row1 + l + c] ?? 0, src[row1 + r + c] ?? 0, fx);
        data[dst + c] = Math.round(lerp(top, bottom, fy));
      }
      dst += 4;
    }
  }
  return { ...image, width: outWidth, height: outHeight, data };
}

/**
 * The working raster for a supersample factor: the exact integer grid of
 * upscaleBy, or for a fractional factor (the budget taper) the rounded grid
 * of about `factor`x each side, sampled with the same bilinear rule.
 */
export function upscaleToWorkingGrid(image: RawImageData, factor: number): RawImageData {
  if (isValidUpscaleFactor(factor)) return upscaleBy(image, factor);
  if (!Number.isFinite(factor) || factor <= 1) return image;
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const columns = bilinearTaps(image.width, width);
  const rows = bilinearTaps(image.height, height);
  const data = new Uint8ClampedArray(width * height * 4);
  const src = image.data;
  const rowBytes = image.width * 4;
  for (let oy = 0; oy < height; oy += 1) {
    const fy = rows.weight[oy] as number;
    const row0 = (rows.low[oy] as number) * rowBytes;
    const row1 = (rows.high[oy] as number) * rowBytes;
    for (let ox = 0; ox < width; ox += 1) {
      const fx = columns.weight[ox] as number;
      const l = (columns.low[ox] as number) * 4;
      const r = (columns.high[ox] as number) * 4;
      const dst = (oy * width + ox) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = lerp(src[row0 + l + c] ?? 0, src[row0 + r + c] ?? 0, fx);
        const bottom = lerp(src[row1 + l + c] ?? 0, src[row1 + r + c] ?? 0, fx);
        data[dst + c] = Math.round(lerp(top, bottom, fy));
      }
    }
  }
  return { ...image, width, height, data };
}

// Source taps for each output sample along one axis: output pixel o samples
// the source at (o + 0.5) * size / outSize - 0.5, clamped at the edges.
function bilinearTaps(
  size: number,
  outSize: number,
): { readonly low: Int32Array; readonly high: Int32Array; readonly weight: Float64Array } {
  const low = new Int32Array(outSize);
  const high = new Int32Array(outSize);
  const weight = new Float64Array(outSize);
  const step = size / outSize;
  for (let o = 0; o < outSize; o += 1) {
    const at = (o + 0.5) * step - 0.5;
    const base = Math.floor(at);
    weight[o] = at - base;
    low[o] = clampCoord(base, size);
    high[o] = clampCoord(base + 1, size);
  }
  return { low, high, weight };
}

/**
 * Map vectors traced on `working` (made by upscaleToWorkingGrid) back to the
 * `source` grid. An exact integer grid divides by its factor exactly as
 * downscaleTracedPaths does; a rounded fractional grid scales each axis by
 * its own ratio so both far edges land on the source's edges.
 */
export function restoreFromWorkingGrid(
  paths: ReadonlyArray<ColoredPath>,
  source: Pick<RawImageData, 'width' | 'height'>,
  working: Pick<RawImageData, 'width' | 'height'>,
): ColoredPath[] {
  const factor = working.width / source.width;
  if (isValidUpscaleFactor(factor) && working.height === source.height * factor) {
    return downscaleTracedPaths(paths, factor);
  }
  const scaleX = source.width / working.width;
  const scaleY = source.height / working.height;
  const point = (p: Vec2): Vec2 => ({ x: p.x * scaleX, y: p.y * scaleY });
  return paths.map((path) => ({
    color: path.color,
    polylines: path.polylines.map((polyline) => ({
      points: polyline.points.map(point),
      closed: polyline.closed,
    })),
    ...(path.curves === undefined
      ? {}
      : { curves: path.curves.map((curve) => scaleCurveAxes(curve, point, scaleX, scaleY)) }),
  }));
}

// Axis scaling is affine, so Bezier control points map exactly.
function scaleCurveAxes(
  curve: CurveSubpath,
  point: (p: Vec2) => Vec2,
  scaleX: number,
  scaleY: number,
): CurveSubpath {
  return {
    start: point(curve.start),
    closed: curve.closed,
    segments: curve.segments.map((segment) => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic') {
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      }
      return {
        ...segment,
        radiusX: segment.radiusX * scaleX,
        radiusY: segment.radiusY * scaleY,
        to: point(segment.to),
      };
    }),
  };
}

// 2x convenience wrapper retained for the existing thin-stroke callers/tests.
export function upscaleDouble(image: RawImageData): RawImageData {
  return upscaleBy(image, MIN_UPSCALE_FACTOR);
}

// Scale traced vectors back to source coordinates by dividing every point by
// the upscale factor. Pure coordinate transform — closed flags and colours are
// carried through untouched. Fails closed on an invalid factor by returning the
// paths unchanged (mirrors upscaleBy's identity behaviour).
export function downscaleTracedPaths(
  paths: ReadonlyArray<ColoredPath>,
  factor: number,
): ColoredPath[] {
  if (!isValidUpscaleFactor(factor)) return paths.map((path) => ({ ...path }));
  return scaleTracedPathsUniform(paths, 1 / factor);
}

/** Uniformly scale traced polylines and canonical curves. */
export function scaleTracedPathsUniform(
  paths: ReadonlyArray<ColoredPath>,
  scale: number,
): ColoredPath[] {
  if (!Number.isFinite(scale) || scale <= 0) return paths.map((path) => ({ ...path }));
  return paths.map((path) => ({
    color: path.color,
    polylines: path.polylines.map((polyline) => scalePolyline(polyline, scale)),
    ...(path.curves === undefined
      ? {}
      : {
          curves: path.curves.map((curve) => transformCurveSubpathUniform(curve, { scale })),
        }),
  }));
}

function scalePolyline(polyline: Polyline, scale: number): Polyline {
  const points: Vec2[] = polyline.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
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

function clampCoord(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
