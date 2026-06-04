// Phase F.2 raster engrave module — pure-core functions for converting
// rasters (greyscale luma buffers) into per-pixel power schedules
// (S values) ready for the raster G-code emit path.
//
// Exports F.2.a (dither), F.2.b (emit-raster), F.2.c (preview-data),
// and F.4 (rasterize-vector — Convert to Bitmap, ADR-029).

export type { DitherAlgorithm, DitherInput, DitherOptions } from './dither';
export { dither } from './dither';

export type { EmitRasterInput } from './emit-raster';
export { emitRasterGroup } from './emit-raster';

export type { LumaAdjustments } from './luma-adjust';
export { applyLumaAdjustments } from './luma-adjust';

export { rasterPreviewRgba } from './preview-data';

export type { LumaRaster } from './luma-resample';
export { pixelExtentForMm, resampleLumaNearest, whiteLuma } from './luma-resample';

export type { VectorRaster, VectorRasterInput } from './rasterize-vector';
export { rasterizeVectorToLuma } from './rasterize-vector';
