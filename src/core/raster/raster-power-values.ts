/** Numeric raster power storage. Uint16 input remains accepted for legacy and
 * fixture callers; compiled output uses Float64 so controller S values never
 * wrap at a typed-array boundary. */
export type RasterPowerValues = Uint16Array | Float64Array;
