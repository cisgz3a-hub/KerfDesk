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
// controls what.
export const TRACE_PRESETS: Readonly<Record<string, TraceOptions>> = {
  Smooth: {
    numberOfColors: 2,
    pathOmit: 16,
    lineTolerance: 2,
    quadraticTolerance: 2,
    blurRadius: 5,
    blurDelta: 40,
    lineFilter: true,
  },
  Sharp: {
    numberOfColors: 2,
    pathOmit: 4,
    lineTolerance: 0.5,
    quadraticTolerance: 0.5,
    blurRadius: 0,
    blurDelta: 0,
    lineFilter: false,
  },
  Detailed: {
    numberOfColors: 4,
    pathOmit: 4,
    lineTolerance: 1,
    quadraticTolerance: 1,
    blurRadius: 1,
    blurDelta: 10,
    lineFilter: true,
  },
  Photo: {
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
  return tracer.imagedataToSVG(image, {
    numberofcolors: options.numberOfColors,
    pathomit: options.pathOmit,
    ltres: options.lineTolerance,
    qtres: options.quadraticTolerance,
    // Pre-blur + line-filter — the quality knobs Phase E v1 missed.
    // Higher blurradius + lineFilter together produce noticeably
    // cleaner traces on photo-like and hand-drawn input.
    blurradius: options.blurRadius,
    blurdelta: options.blurDelta,
    linefilter: options.lineFilter,
    // Disable scale + viewbox attributes — we want raw mm-scale
    // coordinates that match the input image dimensions, so the
    // workspace fit-to-bed math treats it like any other SVG.
    viewbox: false,
    desc: false,
  });
}
