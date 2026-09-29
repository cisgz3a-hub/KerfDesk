// The pixels a headless raster decoder hands the tracer (ADR-477): straight
// 8-bit RGBA on the stored pixel grid, plus the physical size a format
// carries in its own header when the shared PNG/JPEG density reader cannot
// see it (TIFF resolution tags, BMP pixels-per-metre).

export type DecodedRaster = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** Embedded density in dots per inch, when the format's header states one. */
  readonly dpi?: { readonly x: number; readonly y: number };
};

/** Largest raster the command decodes: 16384 x 16384 RGBA is 1 GiB. */
export const MAX_DECODE_PIXELS = 16384 * 16384;

export function assertRasterSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('The image has no pixels.');
  }
  if (width * height > MAX_DECODE_PIXELS) {
    throw new Error(`The image is ${width} x ${height} pixels; the limit is 268 megapixels.`);
  }
}
