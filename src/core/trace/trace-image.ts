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
  // Path tolerance — higher values smooth jagged edges at the cost
  // of fine detail. Default 1.0; range 0.5-3.0 in practice.
  readonly pathOmit: number;
  // Line/curve fit tolerances. Higher = smoother curves, fewer
  // segments. ltres = straight-line tolerance, qtres = quadratic.
  readonly lineTolerance: number;
  readonly quadraticTolerance: number;
};

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  numberOfColors: 2,
  pathOmit: 8,
  lineTolerance: 1,
  quadraticTolerance: 1,
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
    // Disable scale + viewbox attributes — we want raw mm-scale
    // coordinates that match the input image dimensions, so the
    // workspace fit-to-bed math treats it like any other SVG.
    viewbox: false,
    desc: false,
  });
}
