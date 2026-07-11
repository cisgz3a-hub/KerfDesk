// Trace option types + shared preprocessing chain, plus the LEGACY
// imagetracerjs SVG-string path.
//
// Reality check (2026-07-03): every surfaced preset routes through the
// clean-room potrace / centerline / edge backends via
// traceImageToColoredPaths (see index.ts). imagetracerjs is reachable
// only from non-preset multi-colour options; traceImageToSvgString below
// is its SVG-string variant, kept for API compatibility and exercised by
// tests only.
//
// imagetracerjs is public-domain (Unlicense) per RESEARCH_LOG and
// ADR-017 allow-list. Untyped JS lib; wrapped here with a narrow
// type assertion at the boundary so the rest of the codebase only
// sees clean function signatures.
//
// Lazy-loaded via dynamic import (A6 audit fix) so the ~80 KB
// minified weight doesn't land in the initial bundle — users who
// never open Trace Image never download it. The cached promise
// means subsequent traces hit memory, not the network.
//
// Pure-core compliant: no clock, no random, no I/O. Takes data
// in, gives string out (asynchronously now, to allow the lazy
// load; the trace work itself is still synchronous CPU).

import { finiteOr } from '../util';
import type { CrackSubPixelField } from './contour-boundary';
import type { TraceOptions } from './trace-option-types';
import { fillPinholes } from './fill-pinholes';
import { despeckle, hasImpulseNoise, medianFilter, otsuThreshold } from './preprocess';
import { adjustBrightness, adjustContrast, adjustGamma, invertImage } from './raster-prep';
import { shouldUseSketchTrace } from './auto-sketch-trace';

// Internal type for the imagetracer module surface we use. Keeps
// the `as` cast contained to one place.
type ImageTracerModule = {
  readonly imagedataToSVG: (imgd: RawImageData, options?: Record<string, unknown>) => string;
};

let tracerPromise: Promise<ImageTracerModule> | null = null;
async function loadTracer(): Promise<ImageTracerModule> {
  if (tracerPromise === null) {
    // @ts-expect-error — imagetracerjs ships no type declarations
    tracerPromise = import('imagetracerjs')
      .then((mod) => {
        const resolved = (mod.default ?? mod) as unknown as ImageTracerModule;
        return resolved;
      })
      .catch((error: unknown) => {
        tracerPromise = null;
        throw error;
      });
  }
  return tracerPromise;
}

// Minimal shape matching the ImageData browser type. Lets tests
// construct fixtures without a real browser canvas.
export type RawImageData = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

// RGBA channel count per pixel — the multiplier relating dimensions to buffer
// length.
const RGBA_CHANNELS = 4;

// Shape guard for a RawImageData: width/height must be finite positive integers
// and the buffer must hold exactly width*height*4 bytes (one RGBA quad per
// pixel). Callers that index the buffer rely on this invariant; a malformed
// shape otherwise reads past the array or sizes a wrong-shape output.
export function isValidRawImageData(image: RawImageData): boolean {
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  return data.length === width * height * RGBA_CHANNELS;
}

export type { TraceOptions } from './trace-option-types';

// Sensible defaults for engraving — 2 colors (mono), light blur to
// kill noise, line filtering on. Was the gap between Phase E v1
// and v1.1: v1 left blurRadius=0 and lineFilter=false, producing
// the "very uneven" output the user reported.
export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  numberOfColors: 2,
  pathOmit: 8,
  lineTolerance: 1,
  quadraticTolerance: 1,
  blurRadius: 2,
  blurDelta: 20,
  lineFilter: true,
};

export async function traceImageToSvgString(
  image: RawImageData,
  options: TraceOptions = DEFAULT_TRACE_OPTIONS,
): Promise<string> {
  const tracer = await loadTracer();
  const prepared = preprocessForTrace(image, options);
  return tracer.imagedataToSVG(prepared, buildImageTracerOptions(options));
}

// Preprocessing chain — each stage is opt-in via TraceOptions flags
// and runs in order: brightness → contrast → gamma → invert → median
// → threshold → despeckle → tracer. See raster-prep.ts and
// preprocess.ts for rationale. Trace creates vectors; raster
// dither/photo processing belongs to Image Mode, not Trace.
//
// Extracted from traceImageToSvgString so complexity stays under
// the project cap (12). Pure function — same inputs, same output.
export function preprocessForTrace(image: RawImageData, options: TraceOptions): RawImageData {
  // Fail closed on a malformed buffer: every downstream stage indexes
  // data[i..i+3] assuming length === width*height*4, so a short/oversized
  // buffer or non-integer dims would read past the array or size a wrong-shape
  // output. Return the input unchanged rather than corrupting it.
  if (!isValidRawImageData(image)) return image;
  // Trace Transparency keys the mask off alpha. If an image is fully opaque,
  // tracing alpha would turn the whole page black, so fall back to luma trace.
  if (shouldTraceAlphaMask(image, options)) {
    const prepared = alphaToMonochrome(
      image,
      options.cutoffLuma ?? 0,
      options.thresholdLuma ?? 128,
    );
    return cleanBinaryMask(prepared, options);
  }
  if (shouldUseSketchTrace(image, options)) {
    const prepared = sketchTraceToMonochrome(
      applyImageAdjustments(image, options),
      // The local-contrast window is denominated in SOURCE pixels; on a
      // supersampled raster it must scale or it halves in real terms and
      // hollows out strokes wider than the window (adaptive-threshold
      // failure mode: recall 0.93 -> 0.66 measured at 2x).
      SKETCH_RADIUS_PX * effectivePixelScale(options),
    );
    return cleanBinaryMask(prepared, options);
  }
  let prepared = applyImageAdjustments(image, options);
  if (shouldApplyMedian(prepared, options.medianFilter)) {
    prepared = medianFilter(prepared);
  }
  prepared = applyThreshold(prepared, options);
  return cleanBinaryMask(prepared, options);
}

// Mask cleanup is the shared tail of every preprocessing branch: despeckle
// (ink specks → white), then pinhole-crack fill (enclosed hairline white
// slivers → ink). Extracting it keeps preprocessForTrace under the
// complexity cap.
function cleanBinaryMask(image: RawImageData, options: TraceOptions): RawImageData {
  // Area-denominated caps scale by pixelScale² on supersampled traces so
  // their SOURCE-pixel semantics hold (a 12px speck at 2x covers 48px).
  const scale = effectivePixelScale(options);
  const despeckled = shouldDespeckle(options)
    ? despeckle(image, (options.despeckleMinPixels ?? 0) * scale * scale)
    : image;
  return options.fillPinholeCracks === true ? fillPinholes(despeckled, scale) : despeckled;
}

/** Sanitized supersampling factor (see TraceOptions.pixelScale). */
export function effectivePixelScale(options: TraceOptions): number {
  const scale = options.pixelScale ?? 1;
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

// Sub-pixel crack field (research brief 2026-07-10): the pre-threshold
// scalar field + its iso value, so the contour walker can interpolate TRUE
// edge crossings instead of quantizing to crack midpoints — the
// anti-aliasing ramp holds the sub-pixel edge position that binarization
// discards. Mirrors preprocessForTrace's branch order; null where no single
// iso-line exists (alpha masks, brightness bands with a cutoff above 0).
export function crackFieldForTrace(
  image: RawImageData,
  options: TraceOptions,
): CrackSubPixelField | null {
  if (!isValidRawImageData(image)) return null;
  if (shouldTraceAlphaMask(image, options)) return null;
  const adjusted = applyImageAdjustments(image, options);
  if (shouldUseSketchTrace(image, options)) {
    // Same scaled window as sketchTraceToMonochrome — the interpolation iso
    // must be the exact iso the mask was cut at.
    return sketchCrackField(adjusted, SKETCH_RADIUS_PX * effectivePixelScale(options));
  }
  const prepared = shouldApplyMedian(adjusted, options.medianFilter)
    ? medianFilter(adjusted)
    : adjusted;
  const threshold = singleIsoThreshold(prepared, options);
  if (threshold === null) return null;
  return lumaCrackField(prepared, threshold);
}

const BACKGROUND_LUMA = 255;

function singleIsoThreshold(prepared: RawImageData, options: TraceOptions): number | null {
  if (options.cutoffLuma !== undefined) {
    // The band's lower cutoff is a second iso-line; only the degenerate
    // cutoff-0 band (the LightBurn default) has a single crossing.
    return options.cutoffLuma === 0 ? (options.thresholdLuma ?? 128) : null;
  }
  if (options.thresholdLuma !== undefined) return options.thresholdLuma;
  if (options.useOtsuThreshold === true) return otsuThreshold(prepared);
  return null;
}

function lumaCrackField(prepared: RawImageData, thresholdLuma: number): CrackSubPixelField {
  const { width, height } = prepared;
  const luma = lumaBuffer(prepared);
  return {
    thresholdAt: (): number => thresholdLuma,
    lumaAt: (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return BACKGROUND_LUMA;
      return luma[y * width + x] ?? BACKGROUND_LUMA;
    },
  };
}

// The sketch cut is luma < localMean − bias — a position-dependent
// threshold, exposed as thresholdAt so the walker interpolates raw luma
// against the local iso value. (Exact-equality pixels classify background in
// the mask; the walker's straddle check falls back to the midpoint there.)
function sketchCrackField(adjusted: RawImageData, radiusPx = SKETCH_RADIUS_PX): CrackSubPixelField {
  const { width, height } = adjusted;
  const luma = lumaBuffer(adjusted);
  const integral = integralLuma(luma, width, height);
  return {
    thresholdAt: (x: number, y: number): number => {
      const cx = Math.min(width - 1, Math.max(0, x));
      const cy = Math.min(height - 1, Math.max(0, y));
      return localMean(integral, width, height, cx, cy, radiusPx) - SKETCH_CONTRAST_BIAS;
    },
    lumaAt: (x: number, y: number): number => {
      if (x < 0 || y < 0 || x >= width || y >= height) return BACKGROUND_LUMA;
      return luma[y * width + x] ?? BACKGROUND_LUMA;
    },
  };
}

// Median gate. true forces it, false/undefined skips it, and 'auto' defers
// to the impulse-noise detector so clean line art keeps its small features
// while noisy scans still get de-speckled (see medianFilter's doc comment).
function shouldApplyMedian(
  image: RawImageData,
  medianFilterOption: boolean | 'auto' | undefined,
): boolean {
  if (medianFilterOption === 'auto') return hasImpulseNoise(image);
  return medianFilterOption === true;
}

// Brightness → contrast → gamma → invert. Each is a no-op at its
// neutral value (0 / 0 / 1 / false) and returns the input ref-equal,
// so chaining is cheap when the user hasn't touched a slider.
function applyImageAdjustments(image: RawImageData, options: TraceOptions): RawImageData {
  let out = image;
  // Non-finite brightness/contrast normalize to their neutral 0 (a NaN/Infinity
  // delta or factor otherwise clamps every channel to 0 — silent blackening);
  // non-finite gamma normalizes to the neutral 1.0. Guarding at the read point
  // keeps the raster-prep ops themselves free of trace-specific policy.
  const brightness = finiteOr(options.brightness ?? 0, 0);
  const contrast = finiteOr(options.contrast ?? 0, 0);
  const gamma = finiteOr(options.gamma ?? 1, 1);
  if (brightness !== 0) {
    out = adjustBrightness(out, brightness);
  }
  if (contrast !== 0) {
    out = adjustContrast(out, contrast);
  }
  if (gamma !== 1) {
    out = adjustGamma(out, gamma);
  }
  if (options.invert === true) {
    out = invertImage(out);
  }
  return out;
}

// Manual Cutoff/Threshold wins over Otsu. LightBurn's trace controls
// are explicit user input; Otsu is only an automatic preset default.
function applyThreshold(image: RawImageData, options: TraceOptions): RawImageData {
  if (options.cutoffLuma !== undefined) {
    return thresholdBandToMonochrome(image, options.cutoffLuma, options.thresholdLuma ?? 128);
  }
  if (options.thresholdLuma !== undefined) {
    return thresholdToMonochrome(image, options.thresholdLuma);
  }
  if (options.useOtsuThreshold === true) {
    return thresholdToMonochrome(image, otsuThreshold(image));
  }
  return image;
}

// Despeckle only makes sense on binary data — otherwise the luma<128
// classification inside despeckle splits a non-binary image in two
// arbitrarily, eroding mid-tones the user wanted to keep.
function shouldDespeckle(options: TraceOptions): boolean {
  const min = options.despeckleMinPixels;
  if (min === undefined || min <= 1) return false;
  return (
    options.traceTransparency === true ||
    options.sketchTrace === true ||
    options.useOtsuThreshold === true ||
    options.cutoffLuma !== undefined ||
    options.thresholdLuma !== undefined
  );
}

function shouldTraceAlphaMask(image: RawImageData, options: TraceOptions): boolean {
  return options.traceTransparency === true && imageHasTransparency(image);
}

const SKETCH_RADIUS_PX = 8;
const SKETCH_CONTRAST_BIAS = 8;

function sketchTraceToMonochrome(image: RawImageData, radiusPx = SKETCH_RADIUS_PX): RawImageData {
  const luma = lumaBuffer(image);
  const integral = integralLuma(luma, image.width, image.height);
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = y * image.width + x;
      const mean = localMean(integral, image.width, image.height, x, y, radiusPx);
      const v = (luma[pixel] ?? 255) < mean - SKETCH_CONTRAST_BIAS ? 0 : 255;
      const out = pixel * 4;
      data[out] = v;
      data[out + 1] = v;
      data[out + 2] = v;
      data[out + 3] = 255;
    }
  }
  return { width: image.width, height: image.height, data };
}

function lumaBuffer(image: RawImageData): Uint8Array {
  const luma = new Uint8Array(image.width * image.height);
  for (let pixel = 0; pixel < luma.length; pixel += 1) {
    const offset = pixel * 4;
    luma[pixel] = lumaByte(
      image.data[offset] ?? 255,
      image.data[offset + 1] ?? 255,
      image.data[offset + 2] ?? 255,
    );
  }
  return luma;
}

function integralLuma(luma: Uint8Array, width: number, height: number): Float64Array {
  const stride = width + 1;
  const integral = new Float64Array((height + 1) * stride);
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += luma[(y - 1) * width + (x - 1)] ?? 255;
      integral[y * stride + x] = (integral[(y - 1) * stride + x] ?? 0) + rowSum;
    }
  }
  return integral;
}

function localMean(
  integral: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  const x0 = Math.max(0, x - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(width, x + radius + 1);
  const y1 = Math.min(height, y + radius + 1);
  const stride = width + 1;
  const sum =
    (integral[y1 * stride + x1] ?? 0) -
    (integral[y0 * stride + x1] ?? 0) -
    (integral[y1 * stride + x0] ?? 0) +
    (integral[y0 * stride + x0] ?? 0);
  return sum / Math.max(1, (x1 - x0) * (y1 - y0));
}

function imageHasTransparency(image: RawImageData): boolean {
  for (let i = 3; i < image.data.length; i += 4) {
    if ((image.data[i] ?? 255) < 255) return true;
  }
  return false;
}

function alphaToMonochrome(image: RawImageData, cutoff: number, threshold: number): RawImageData {
  const data = new Uint8ClampedArray(image.data.length);
  const lo = clampLuma(Math.min(cutoff, threshold));
  const hi = clampLuma(Math.max(cutoff, threshold));
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] ?? 255;
    const alphaLuma = 255 - alpha;
    const v = alphaLuma >= lo && alphaLuma <= hi ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

function clampLuma(value: number): number {
  return Math.max(0, Math.min(255, value));
}

// Phase E.2 — match LaserForge 1's proven imagetracerjs settings after
// audit found ours were leaving the worst defaults on. The most impactful
// single change is `rightangleenhance: false`. When true
// (imagetracerjs's default!) it forces traced edges toward axis-
// aligned right angles — devastating on organic curves and photos,
// which is exactly what was making images look blocky. LF1 turned
// it off; we now do too.
//
// The rest of the additions match LF1's explicit defaults so
// imagetracerjs has no autonomous behaviour we don't control:
//   - colorquantcycles 1: single quantization pass when used.
//   - layering 0: sequential layer order (vs parallel default 1).
//   - roundcoords 1: 1-decimal coordinate rounding.
//   - strokewidth 0: no stroke widths in output.
//   - scale 1: explicit 1:1 input-to-output scale.
//
// Exported for direct testing — the regression-test catch was an
// off-the-mark fixed-palette / colour-sampling interaction; we now
// pin the wired-through options directly.
export function buildImageTracerOptions(options: TraceOptions): Record<string, unknown> {
  const opts: Record<string, unknown> = {
    numberofcolors: options.numberOfColors,
    pathomit: options.pathOmit,
    ltres: options.lineTolerance,
    qtres: options.quadraticTolerance,
    blurradius: options.blurRadius,
    blurdelta: options.blurDelta,
    linefilter: options.lineFilter,
    viewbox: false,
    desc: false,
    rightangleenhance: false,
    colorquantcycles: 1,
    layering: 0,
    roundcoords: 1,
    strokewidth: 0,
    scale: 1,
  };
  // colorsampling 0 + fixed palette ONLY when caller forced a palette
  // (Line Art / Smooth / Sharp). A multi-colour options object
  // (numberOfColors > 2, no fixedPalette) needs imagetracerjs's adaptive
  // quantization to produce >2 layers; colorsampling=0 there would
  // collapse them. No surfaced preset does this any more: vector Trace is
  // binary (Photo / Detailed removed, ADR-043); photos engrave via the
  // Image/raster path, not Trace.
  if (options.fixedPalette !== undefined && options.fixedPalette.length > 0) {
    opts['colorsampling'] = 0;
    opts['pal'] = options.fixedPalette.map(hexToRgba);
  }
  return opts;
}

// Convert an RGBA buffer to pure 1-bit black/white. Each output
// pixel is either (255, 255, 255, 255) or (0, 0, 0, 255) based on
// the luminance (ITU-R BT.601: 0.299·R + 0.587·G + 0.114·B). Used
// before tracing to kill anti-aliased edge speckle.
//
// Allocates a fresh Uint8ClampedArray rather than mutating in place
// so callers don't see their input change. Pure function.
export function thresholdToMonochrome(image: RawImageData, threshold: number): RawImageData {
  const data = new Uint8ClampedArray(image.data.length);
  const cutoff = Math.max(0, Math.min(255, threshold));
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i] ?? 0;
    const g = image.data[i + 1] ?? 0;
    const b = image.data[i + 2] ?? 0;
    const luma = lumaByte(r, g, b);
    const v = luma >= cutoff ? 255 : 0;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

export function thresholdBandToMonochrome(
  image: RawImageData,
  cutoff: number,
  threshold: number,
): RawImageData {
  const data = new Uint8ClampedArray(image.data.length);
  const lo = Math.max(0, Math.min(255, Math.min(cutoff, threshold)));
  const hi = Math.max(0, Math.min(255, Math.max(cutoff, threshold)));
  for (let i = 0; i < image.data.length; i += 4) {
    const r = image.data[i] ?? 0;
    const g = image.data[i + 1] ?? 0;
    const b = image.data[i + 2] ?? 0;
    const luma = lumaByte(r, g, b);
    const v = luma >= lo && luma <= hi ? 0 : 255;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data };
}

function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

// Convert '#rrggbb' (or '#rgb') to {r, g, b, a} as imagetracerjs
// expects. Tolerates malformed input by falling back to black.
function hexToRgba(hex: string): { r: number; g: number; b: number; a: number } {
  const cleaned = hex.replace('#', '').trim();
  const expanded =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const valid = Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b);
  return valid ? { r, g, b, a: 255 } : { r: 0, g: 0, b: 0, a: 255 };
}
