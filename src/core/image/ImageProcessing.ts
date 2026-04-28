/**
 * Raster image preprocessing (brightness / contrast / invert).
 * All functions read input and return a new Uint8Array — originals are never mutated.
 *
 * TS 5.7+ models `Uint8Array` with a buffer kind parameter. `new Uint8Array(n)` and
 * `new Uint8Array(copyFrom)` produce `Uint8Array<ArrayBuffer>`. Annotating returns as
 * bare `Uint8Array` widens to `Uint8Array<ArrayBufferLike>`, which then fails assignment
 * to variables inferred from `new Uint8Array(geom.grayscaleData)` in callers. Use an
 * explicit `ArrayBuffer`-backed alias for all public inputs/outputs here.
 */

/** Byte view backed by a concrete `ArrayBuffer` (matches `new Uint8Array(...)` results). */
export type ImageBytes = Uint8Array<ArrayBuffer>;

/** Any byte view acceptable as raster input (slices, copies, etc.). */
export type ImageBytesSource = Uint8Array<ArrayBufferLike>;

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** brightness: -100 to +100. pixel = clamp(pixel + brightness * 2.55) */
export function adjustBrightness(data: ImageBytesSource, brightness: number): ImageBytes {
  const out = new Uint8Array(data.length);
  const delta = brightness * 2.55;
  for (let i = 0; i < data.length; i++) {
    out[i] = clampByte(data[i] + delta);
  }
  return out;
}

/** contrast: -100 to +100. pixel = clamp(((pixel - 128) * (1 + contrast/100)) + 128) */
export function adjustContrast(data: ImageBytesSource, contrast: number): ImageBytes {
  const out = new Uint8Array(data.length);
  const factor = 1 + contrast / 100;
  for (let i = 0; i < data.length; i++) {
    out[i] = clampByte((data[i] - 128) * factor + 128);
  }
  return out;
}

export function invertImage(data: ImageBytesSource): ImageBytes {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = 255 - data[i];
  }
  return out;
}

/** Gamma curve on a copy; gamma typically 0.1–5, 1 = unchanged. */
export function adjustGamma(data: ImageBytesSource, gamma: number): ImageBytes {
  const g = Math.max(0.1, Math.min(5, gamma));
  if (g === 1) return new Uint8Array(data);
  const out = new Uint8Array(data.length);
  const invG = 1 / g;
  for (let i = 0; i < data.length; i++) {
    const nv = Math.pow(Math.max(0, Math.min(1, data[i] / 255)), invG);
    out[i] = clampByte(nv * 255);
  }
  return out;
}

/** Simple 1-bit mask: pixel < threshold → burn (255), else off (0). */
export function thresholdToOneBit(
  data: ImageBytesSource,
  width: number,
  height: number,
  threshold: number,
): ImageBytes {
  const t = Math.max(0, Math.min(255, threshold));
  const out = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] < t ? 255 : 0;
  }
  return out;
}
