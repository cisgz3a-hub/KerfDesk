// Phase E — raster → SVG-string conversion via imagetracerjs.
//
// Takes a "RawImageData" (ImageData-shaped: width + height +
// Uint8ClampedArray of RGBA pixels) plus tracing options, runs
// imagetracerjs's imagedataToSVG, returns the SVG string.
//
// The caller (UI layer or compile pipeline) feeds the resulting
// SVG string through our existing parseSvg() to get ColoredPath[]
// in the standard shape. That keeps Phase E free of any new
// flattening / color-extraction code — same path SVG imports walk.
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

import { type DitherMode, ditherForTrace } from './dither-trace';
import { despeckle, medianFilter, otsuThreshold } from './preprocess';
import { adjustBrightness, adjustContrast, adjustGamma, invertImage } from './raster-prep';

export type { DitherMode } from './dither-trace';

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

export type TraceOptions = {
  // Filled contours preserve source silhouettes for fill engraving.
  // Centerline traces skeletonize dark strokes into open line paths
  // for single-pass vector engraving.
  readonly traceMode?: 'filled-contours' | 'centerline';
  // Number of color quantization buckets. 2 = black-and-white,
  // suitable for most laser engraving. Higher values produce more
  // layers and (usually) more visual fidelity. Range 2-16.
  readonly numberOfColors: number;
  // Path-omit: minimum number of points in a path for it to be
  // kept. Higher values drop small noise blobs.
  readonly pathOmit: number;
  // Line/curve fit tolerances. Higher = smoother curves, fewer
  // segments. ltres = straight-line tolerance, qtres = quadratic.
  readonly lineTolerance: number;
  readonly quadraticTolerance: number;
  // Gaussian blur radius applied BEFORE tracing — pre-smoothing
  // suppresses small pixel-level noise that would otherwise become
  // jagged edges in the output. 0 = no blur (sharp / detailed),
  // 1-5 = progressively smoother. The Phase E v1 ship omitted
  // this, which is why traces looked jagged on photo-like input.
  readonly blurRadius: number;
  // After-blur threshold: pixels whose delta to neighbors is
  // below this value are smoothed. Pairs with blurRadius.
  readonly blurDelta: number;
  // Smooths line angles in the final paths. Boolean. The default
  // imagetracerjs setting is false; we ship it true for cleaner
  // output on hand-drawn / photo-like inputs.
  readonly lineFilter: boolean;
  // When set, forces a fixed palette instead of color-quantizing the
  // input. Use ['#ffffff', '#000000'] for line art — guarantees the
  // output is two layers (background + ink) with no banding from
  // imagetracer's clustering. Hex strings, parsed at the boundary.
  readonly fixedPalette?: ReadonlyArray<string>;
  // Pre-threshold the input to pure 1-bit before tracing. Pixels
  // with luminance ≥ this value become white, the rest black. The
  // most important quality lever for line-art input: it eliminates
  // anti-aliased edges that otherwise become borderline-classified
  // speckle in the trace output. 0..255 range; undefined = skip
  // pre-threshold and feed raw pixels.
  // If set, thresholdLuma becomes the upper bound of LightBurn's
  // inclusive brightness band: cutoffLuma <= luma <= thresholdLuma.
  readonly cutoffLuma?: number;
  readonly thresholdLuma?: number;
  // Phase E.2 quality polish — three pure-core preprocessing
  // stages (see preprocess.ts). Compose in this order:
  //   medianFilter → (otsuThreshold OR thresholdLuma) → despeckle → tracer
  // Each is opt-in via its flag so callers see only the quality
  // they ask for. Defaults in TRACE_PRESETS pick sensible bundles
  // per input class (logo vs photo vs sketch).
  //
  // useOtsuThreshold: when true, the cutoff is picked from the
  // image's luma histogram (Otsu 1979) instead of a fixed value.
  // Overrides thresholdLuma when both are set.
  readonly useOtsuThreshold?: boolean;
  // medianFilter: 3×3 median filter (RGBA → greyscale) applied
  // BEFORE thresholding. Kills salt-and-pepper noise and JPEG
  // artefacts without rounding off real edges the way a Gaussian
  // blur would.
  readonly medianFilter?: boolean;
  // despeckleMinPixels: connected-component despeckle applied AFTER
  // thresholding. Any ink region (4-connected, luma<128) with fewer
  // than N pixels gets flipped to white. 0 or undefined disables.
  // Topology-preserving: holes inside letters (O, B, etc.) survive.
  readonly despeckleMinPixels?: number;
  readonly ignoreLessThanPixels?: number;
  readonly smoothness?: number;
  readonly optimize?: number;
  // Phase E.3 — image-level adjustments matching LF1's
  // ImageProcessing.ts math (see raster-prep.ts). All four run BEFORE the
  // existing median → threshold → despeckle chain, so the cleanup
  // stages operate on pixels the user has already brightened /
  // contrast-pushed / gamma-corrected / inverted to taste.
  //
  // brightness: −100..+100, 0 = no-op. Linear add of brightness*2.55
  // to each channel; +100 saturates black to white.
  readonly brightness?: number;
  // contrast: −100..+100, 0 = no-op. Pivot around 128 with factor
  // 1 + contrast/100. +100 doubles contrast; −100 collapses to grey.
  readonly contrast?: number;
  // gamma: 0.1..5, 1 = no-op. Power curve in normalised space.
  // gamma > 1 brightens midtones; gamma < 1 darkens them.
  readonly gamma?: number;
  // invert: swap each channel to 255 − v. Useful when the source is
  // light-on-dark (white logo on black) and the user wants the laser
  // to engrave the dark areas — flipping the image makes that the
  // standard dark-on-light input every tracer assumes.
  readonly invert?: boolean;
  // ditherMode: pre-trace halftone. Continuous-tone inputs (photos,
  // shaded sketches) collapse into solid silhouettes under a simple
  // threshold; dithering turns the tones into a spatially-distributed
  // binary pattern that the tracer renders as halftoned ink. When set
  // (and not 'none'), the dither replaces the threshold step — its
  // output is already binary, and the despeckle stage is skipped to
  // avoid erasing the dot pattern. Defaults to undefined ('none').
  // See dither-trace.ts for the 13 supported modes.
  readonly ditherMode?: DitherMode;
};

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

// Named presets — each tuned for a different input class. Dialog
// surfaces these so the user doesn't have to know which knob
// controls what. ORDER matters: the first key is the default,
// and "Line Art" is the by-far most common laser-engraving case
// (vector-like logos, line drawings, monochrome signs).
export const TRACE_PRESETS: Readonly<Record<string, TraceOptions>> = {
  'Line Art': {
    // For clean black-on-white logos / line drawings. Phase E.2
    // upgrade stack:
    //   * cutoffLuma / thresholdLuma — LightBurn's default trace
    //     brightness band, inclusive 0..128.
    //   * fixedPalette [white, black] — guarantees a 2-layer output
    //     even if the input has stray non-monochrome pixels.
    //   * despeckleMinPixels 12 — removes connected ink blobs under
    //     12 pixels. Kills JPEG dot artefacts that survived the
    //     threshold.
    //   * pathOmit 16 — second-line defence: drops short paths the
    //     tracer might still emit at edges.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    cutoffLuma: 0,
    thresholdLuma: 128,
    ignoreLessThanPixels: 2,
    smoothness: 1,
    optimize: 0.2,
    despeckleMinPixels: 12,
  },
  Centerline: {
    // For black strokes that should engrave as one path down the
    // middle instead of filled outline contours. Uses the same
    // binarisation as Line Art, then skeletonizes the ink mask.
    traceMode: 'centerline',
    numberOfColors: 2,
    pathOmit: 0,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    useOtsuThreshold: true,
    despeckleMinPixels: 12,
  },
  Smooth: {
    // For slightly noisy / hand-drawn line art. Median filter kills
    // salt-and-pepper noise before threshold; despeckle catches what
    // survives. Blur slider remains for compatibility but the median
    // does most of the work.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 2,
    quadraticTolerance: 2,
    blurRadius: 1,
    blurDelta: 20,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
    medianFilter: true,
    useOtsuThreshold: true,
    despeckleMinPixels: 24,
  },
  Sharp: {
    // For pixel-art / blueprint inputs where every notch matters.
    // Otsu picks a clean cutoff but no median (would round notches).
    // Smaller despeckle so single-pixel features still survive.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 0.5,
    quadraticTolerance: 0.5,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
    fixedPalette: ['#ffffff', '#000000'],
    useOtsuThreshold: true,
    despeckleMinPixels: 4,
  },
  Detailed: {
    // For line drawings with some shading — 4 colors keeps mid-tones
    // as distinct cut layers. Median smooths the shading bands but
    // we don't threshold (multi-colour output).
    numberOfColors: 4,
    pathOmit: 8,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 1,
    blurDelta: 10,
    lineFilter: true,
    medianFilter: true,
  },
  Photo: {
    // For actual photographs — heavy blur + many colors. Produces
    // many layers; intended for posterized-style engraving. Median
    // pre-pass cleans JPEG blocks without rounding edges away.
    numberOfColors: 8,
    pathOmit: 8,
    lineTolerance: 1.5,
    quadraticTolerance: 1.5,
    blurRadius: 3,
    blurDelta: 30,
    lineFilter: true,
    medianFilter: true,
  },
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
// → (dither OR threshold) → despeckle → tracer. See raster-prep.ts,
// dither-trace.ts and preprocess.ts for rationale and algorithm
// references. The composition matters: image-level adjustments run
// BEFORE noise filtering so the median sees the user's intended tonal
// range; dither/threshold then reads that range; despeckle operates
// on the binarised result.
//
// Dither and threshold are mutually exclusive — both binarize the
// image, so chaining would discard the dither pattern. When a dither
// mode is active, the despeckle stage is also skipped because its
// "remove small ink regions" semantics would erase the intentional
// halftone dots.
//
// Extracted from traceImageToSvgString so complexity stays under
// the project cap (12). Pure function — same inputs, same output.
export function preprocessForTrace(image: RawImageData, options: TraceOptions): RawImageData {
  let prepared = applyImageAdjustments(image, options);
  if (options.medianFilter === true) {
    prepared = medianFilter(prepared);
  }
  if (isDitherActive(options)) {
    return ditherForTrace(prepared, options.ditherMode ?? 'none');
  }
  prepared = applyThreshold(prepared, options);
  if (shouldDespeckle(options)) {
    prepared = despeckle(prepared, options.despeckleMinPixels ?? 0);
  }
  return prepared;
}

function isDitherActive(options: TraceOptions): boolean {
  return options.ditherMode !== undefined && options.ditherMode !== 'none';
}

// Brightness → contrast → gamma → invert. Each is a no-op at its
// neutral value (0 / 0 / 1 / false) and returns the input ref-equal,
// so chaining is cheap when the user hasn't touched a slider.
function applyImageAdjustments(image: RawImageData, options: TraceOptions): RawImageData {
  let out = image;
  if (options.brightness !== undefined && options.brightness !== 0) {
    out = adjustBrightness(out, options.brightness);
  }
  if (options.contrast !== undefined && options.contrast !== 0) {
    out = adjustContrast(out, options.contrast);
  }
  if (options.gamma !== undefined && options.gamma !== 1) {
    out = adjustGamma(out, options.gamma);
  }
  if (options.invert === true) {
    out = invertImage(out);
  }
  return out;
}

// Otsu wins when both are set — it derives the cutoff from the
// histogram, so a hand-set thresholdLuma would be ignored anyway.
function applyThreshold(image: RawImageData, options: TraceOptions): RawImageData {
  if (options.useOtsuThreshold === true) {
    return thresholdToMonochrome(image, otsuThreshold(image));
  }
  if (options.cutoffLuma !== undefined) {
    return thresholdBandToMonochrome(image, options.cutoffLuma, options.thresholdLuma ?? 128);
  }
  if (options.thresholdLuma !== undefined) {
    return thresholdToMonochrome(image, options.thresholdLuma);
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
    options.useOtsuThreshold === true ||
    options.cutoffLuma !== undefined ||
    options.thresholdLuma !== undefined
  );
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
  // colorsampling 0 + fixed palette ONLY when caller forced a
  // palette (Line Art / Smooth / Sharp). Multi-colour presets
  // (Detailed / Photo) need imagetracerjs's adaptive quantization
  // to produce >2 layers; colorsampling=0 there would collapse them.
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
