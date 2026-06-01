// core/trace — Phase E raster vectorization. Two output paths:
//   - traceImageToSvgString: legacy SVG-string path that feeds parseSvg
//     for the polyline conversion. Kept for the preview overlay so
//     existing rendering code stays unchanged.
//   - traceImageToColoredPaths: LF1-port direct path that bypasses
//     parseSvg's curve-flattening by sampling Q-segments at high
//     density inline. Used by the import commit so engrave fidelity
//     matches imagetracerjs's analytic curves.
//
// Both share the same preprocessing chain (raster-prep image
// adjustments → median → dither/threshold → despeckle).

export type { DitherMode, RawImageData, TraceOptions } from './trace-image';
export {
  DEFAULT_TRACE_OPTIONS,
  TRACE_PRESETS,
  thresholdBandToMonochrome,
  traceImageToSvgString,
} from './trace-image';
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
export { traceImageToCenterlinePaths } from './centerline-trace';
export { coloredPathsToSvg } from './paths-to-svg';
// Phase E.2 preprocessing primitives. Exposed so tests + future UI
// (e.g. an "Advanced" trace dialog showing the auto-computed Otsu
// threshold) can call them directly. Each is pure-core.
export { despeckle, medianFilter, otsuThreshold } from './preprocess';
// Phase E.3 LF1 port — dither modes catalogue for the import dialog
// dropdown and image-level adjustment functions (brightness etc.) for
// any future "Advanced" panel.
export { DITHER_MODES, ditherForTrace } from './dither-trace';
export { adjustBrightness, adjustContrast, adjustGamma, invertImage } from './raster-prep';
