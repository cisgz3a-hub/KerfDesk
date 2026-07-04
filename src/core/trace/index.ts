// core/trace — raster vectorization. The single entry point the app uses
// (dialog preview, import commit, batch trace) is traceImageToColoredPaths,
// which dispatches by options:
//   - 2-colour fixed-palette options (ALL surfaced presets: Line Art,
//     Smooth, Sharp) → the clean-room potrace backend (potrace-trace.ts).
//   - traceMode 'centerline' / 'edge' → the medial-axis and Canny-chain
//     tracers.
//   - anything else (multi-colour, no fixed palette — reachable only via
//     non-preset options) → the legacy imagetracerjs tracedata path.
// traceImageToSvgString is the legacy SVG-string variant of that last
// path; no app code calls it today (tests only).
//
// All paths share the same preprocessing chain (raster-prep image
// adjustments → median → threshold → despeckle).

export type { RawImageData, TraceOptions } from './trace-image';
export {
  DEFAULT_TRACE_OPTIONS,
  thresholdBandToMonochrome,
  traceImageToSvgString,
} from './trace-image';
export { TRACE_PRESETS } from './trace-presets';
export {
  DEFAULT_LIGHTBURN_TRACE_SETTINGS,
  lightBurnTraceSettingsToPotraceParams,
  type LightBurnTraceSettings,
  type PotraceParams,
} from './potrace-params';
export {
  boundsFromColoredPaths,
  traceImageToColoredPaths,
  tracedataToColoredPaths,
} from './trace-to-paths';
export { shouldUsePotraceTraceBackend, traceImageToPotraceColoredPaths } from './potrace-trace';
export { traceCenterlineStrokePaths } from './centerline';
export { coloredPathsToSvg } from './paths-to-svg';
export type { BatchTraceDependencies, BatchTraceImageJob, BatchTraceSvgFile } from './batch-trace';
export { traceImagesToSvgFiles } from './batch-trace';
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
