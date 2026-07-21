// RGBA pixel-buffer primitives for the Image Studio editor core (ADR-242).
//
// The editor's working document is one RGBA8 buffer at source resolution.
// Pixel arrays are far too large for the spread-and-copy state style, so this
// module's contract is explicit: functions either return new buffers, or carry
// an `InPlace` suffix and mutate a caller-owned buffer passed as the first
// argument. ADR-242 records this bounded exception to the no-mutable-args rule.

export const RGBA_CHANNELS = 4;

// White is the editor's "empty" pixel: white neither burns (engrave) nor
// traces (ink band), so clearing to white is the raster equivalent of delete.
export const WHITE_BYTE = 255;

const MIN_DIMENSION_PX = 1;

export type RgbaBuffer = {
  readonly width: number;
  readonly height: number;
  /** RGBA8, row-major, length === width * height * RGBA_CHANNELS. */
  readonly data: Uint8ClampedArray;
};

/**
 * Create an opaque-white buffer. Dimensions are floored and clamped to at
 * least 1 px; size caps live at the import boundary (BURN_MAX_EDGE_PX), not
 * here.
 */
export function createRgbaBuffer(width: number, height: number): RgbaBuffer {
  const w = Math.max(MIN_DIMENSION_PX, Math.floor(width));
  const h = Math.max(MIN_DIMENSION_PX, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
  data.fill(WHITE_BYTE);
  return { width: w, height: h, data };
}

/** Deep-copy a buffer; the clone shares no bytes with the source. */
export function cloneRgbaBuffer(source: RgbaBuffer): RgbaBuffer {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data),
  };
}

/** Byte-exact equality (dimensions and every channel). */
export function rgbaBuffersEqual(a: RgbaBuffer, b: RgbaBuffer): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 1) {
    if ((a.data[i] ?? 0) !== (b.data[i] ?? 0)) return false;
  }
  return true;
}
