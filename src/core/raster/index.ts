// Phase F.2 raster engrave module — pure-core functions for converting
// rasters (greyscale luma buffers) into per-pixel power schedules
// (S values) ready for the raster G-code emit path.
//
// Exports F.2.a (dither), F.2.b (emit-raster), and F.2.c (preview-data).

export type { DitherAlgorithm, DitherInput, DitherOptions } from './dither';
export { dither } from './dither';

export type { EmitRasterInput } from './emit-raster';
export { emitRasterGroup } from './emit-raster';

export { rasterPreviewRgba } from './preview-data';
