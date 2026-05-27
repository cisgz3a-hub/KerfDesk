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
// Pure-core compliant: no clock, no random, no I/O. Takes data
// in, gives string out.

// @ts-expect-error — imagetracerjs ships no type declarations; we
// take it as `unknown`-shaped and assert the minimal API we use.
import ImageTracer from 'imagetracerjs';

// Minimal shape matching the ImageData browser type. Lets tests
// construct fixtures without a real browser canvas.
export type RawImageData = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
};

export type TraceOptions = {
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
    // For clean black-on-white logos / line drawings. The fixed
    // palette is the key knob: it forces a pure 2-color (white +
    // black) output instead of letting imagetracer's clustering
    // invent gray bands that fragment fine strokes. pathOmit 16
    // drops the small disconnected dots that otherwise litter the
    // result on noisy scans.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: true,
    fixedPalette: ['#ffffff', '#000000'],
  },
  Smooth: {
    // For slightly noisy / hand-drawn line art. Adds blur to
    // suppress noise at the cost of a little detail loss.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 2,
    quadraticTolerance: 2,
    blurRadius: 5,
    blurDelta: 40,
    lineFilter: true,
  },
  Sharp: {
    // For pixel-art / blueprint inputs where every notch matters.
    // No blur, low tolerances, but pathOmit still 16 to drop
    // single-pixel speckle.
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 0.5,
    quadraticTolerance: 0.5,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
  },
  Detailed: {
    // For line drawings with some shading — 4 colors keeps
    // mid-tones as distinct cut layers.
    numberOfColors: 4,
    pathOmit: 8,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 1,
    blurDelta: 10,
    lineFilter: true,
  },
  Photo: {
    // For actual photographs — heavy blur + many colors. Produces
    // many layers; intended for posterized-style engraving.
    numberOfColors: 8,
    pathOmit: 8,
    lineTolerance: 1.5,
    quadraticTolerance: 1.5,
    blurRadius: 3,
    blurDelta: 30,
    lineFilter: true,
  },
};

// Internal type for the imagetracer module surface we use. Keeps
// the `as` cast contained to one place.
type ImageTracerModule = {
  readonly imagedataToSVG: (
    imgd: RawImageData,
    options?: Record<string, unknown>,
  ) => string;
};

export function traceImageToSvgString(
  image: RawImageData,
  options: TraceOptions = DEFAULT_TRACE_OPTIONS,
): string {
  const tracer = ImageTracer as unknown as ImageTracerModule;
  const baseOpts: Record<string, unknown> = {
    numberofcolors: options.numberOfColors,
    pathomit: options.pathOmit,
    ltres: options.lineTolerance,
    qtres: options.quadraticTolerance,
    // Pre-blur + line-filter — quality knobs Phase E v1 missed.
    blurradius: options.blurRadius,
    blurdelta: options.blurDelta,
    linefilter: options.lineFilter,
    // Disable scale + viewbox attributes so the raw mm-scale
    // coordinates match the input image dimensions.
    viewbox: false,
    desc: false,
  };
  // Fixed palette overrides color quantization entirely — the
  // tracer's `pal` accepts {r, g, b, a} entries. Used by the
  // "Line Art" preset to force a clean 2-color output.
  if (options.fixedPalette !== undefined && options.fixedPalette.length > 0) {
    baseOpts['pal'] = options.fixedPalette.map(hexToRgba);
  }
  return tracer.imagedataToSVG(image, baseOpts);
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
