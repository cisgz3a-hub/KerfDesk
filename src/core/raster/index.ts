// Phase F.2 raster engrave module — pure-core functions for converting
// rasters (greyscale luma buffers) into per-pixel power schedules
// (S values) ready for the raster G-code emit path.
//
// Currently exports F.2.a (dither). F.2.b (emit-raster) and F.2.c
// (preview-data) land in subsequent commits.

export type { DitherAlgorithm, DitherInput, DitherOptions } from './dither';
export { dither } from './dither';
