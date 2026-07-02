// core/trace — Phase E raster vectorization. Two output paths:
//   - traceImageToSvgString: legacy SVG-string path that feeds parseSvg
//     for the polyline conversion. Kept for the preview overlay so
//     existing rendering code stays unchanged.
//   - traceImageToColoredPaths: tracedata direct path that bypasses
//     parseSvg's curve-flattening by sampling Q-segments at high
//     density inline. Used by the import commit so engrave fidelity
//     matches imagetracerjs's analytic curves.
//
// Both share the same preprocessing chain (raster-prep image
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
