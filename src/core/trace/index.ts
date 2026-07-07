// core/trace — raster vectorization. The single entry point the app uses
// (dialog preview, import commit, batch trace) is traceImageToColoredPaths,
// which dispatches by options:
//   - 2-colour fixed-palette options (ALL surfaced filled presets: Line Art,
//     Smooth, Sharp) → the in-house contour backend (contour-trace.ts),
//     built on the clean-room centerline machinery.
//   - traceMode 'centerline' / 'edge' → the medial-axis and edge tracers
//     (edge shares the contour finisher).
//   - anything else (multi-colour, no fixed palette — reachable only via
//     non-preset options) → the legacy imagetracerjs tracedata path.
// traceImageToSvgString is the legacy SVG-string variant of that last
// path; no app code calls it today (tests only).
//
// The whole pipeline is original / permissively-licensed code — the
// potrace-derived backend was removed (ADR-122). All paths share the same
// preprocessing chain (raster-prep image adjustments → median → threshold →
// despeckle).

export type { RawImageData, TraceOptions } from './trace-image';
export {
  DEFAULT_TRACE_OPTIONS,
  thresholdBandToMonochrome,
  traceImageToSvgString,
} from './trace-image';
export { TRACE_PRESETS } from './trace-presets';
export {
  DEFAULT_LIGHTBURN_TRACE_SETTINGS,
  type LightBurnTraceSettings,
} from './lightburn-trace-settings';
export {
  boundsFromColoredPaths,
  traceImageToColoredPaths,
  tracedataToColoredPaths,
} from './trace-to-paths';
export { isBinaryContourPreset } from './contour-trace';
export { traceCenterlineStrokePaths } from './centerline';
export { coloredPathsToSvg } from './paths-to-svg';
export type { BatchTraceDependencies, BatchTraceImageJob, BatchTraceSvgFile } from './batch-trace';
export { traceImagesToSvgFiles } from './batch-trace';
export type { EnhanceRegionArgs, RegionTraceFn } from './region-enhance';
export { enhanceRegionPaths } from './region-enhance';
export type { TraceBoundary } from './trace-boundary';
export {
  cropRawImageData,
  normalizeTraceBoundary,
  offsetBounds,
  offsetColoredPaths,
} from './trace-boundary';
// Phase E.2 preprocessing primitives. Exposed so tests + future UI
// (e.g. an "Advanced" trace dialog showing the auto-computed Otsu
// threshold) can call them directly. Each is pure-core.
export { despeckle, medianFilter, otsuThreshold } from './preprocess';
export { adjustBrightness, adjustContrast, adjustGamma, invertImage } from './raster-prep';
