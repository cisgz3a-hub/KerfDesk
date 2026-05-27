// core/trace — Phase E raster vectorization. Pure: takes pixel data
// in, gives an SVG string out. The UI layer feeds that string into
// parseSvg() to get ColoredPath polylines, which then become a
// TracedImage SceneObject and flow through the existing compile +
// emit pipeline.

export type { RawImageData, TraceOptions } from './trace-image';
export { DEFAULT_TRACE_OPTIONS, traceImageToSvgString } from './trace-image';
