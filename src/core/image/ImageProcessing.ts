/**
 * Raster image preprocessing (brightness / contrast / invert).
 * All functions read input and return a new Uint8Array — originals are never mutated.
 */

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** brightness: -100 to +100. pixel = clamp(pixel + brightness * 2.55) */
export function adjustBrightness(data: Uint8Array, brightness: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const delta = brightness * 2.55;
  for (let i = 0; i < data.length; i++) {
    out[i] = clampByte(data[i] + delta);
  }
  return out;
}

/** contrast: -100 to +100. pixel = clamp(((pixel - 128) * (1 + contrast/100)) + 128) */
export function adjustContrast(data: Uint8Array, contrast: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const factor = 1 + contrast / 100;
  for (let i = 0; i < data.length; i++) {
    out[i] = clampByte((data[i] - 128) * factor + 128);
  }
  return out;
}

export function invertImage(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = 255 - data[i];
  }
  return out;
}

/** Gamma curve on a copy; gamma typically 0.1–5, 1 = unchanged. */
export function adjustGamma(data: Uint8Array, gamma: number): Uint8Array {
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
  data: Uint8Array,
  width: number,
  height: number,
  threshold: number,
): Uint8Array {
  const t = Math.max(0, Math.min(255, threshold));
  const out = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] < t ? 255 : 0;
  }
  return out;
}
