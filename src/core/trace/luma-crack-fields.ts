// The luma crack fields of the contour preparation: a global cut and the
// sketch window's local cut, with the luma plane both read. Split from
// trace-image.ts (the file line cap). Their arrays are registered for
// whole-grid passes (crack-field-planes.ts).

import type { CrackSubPixelField } from './saddle-connectivity';
import { registerBoxThreshold, registerLumaPlane } from './crack-field-planes';
import { integralLuma, localMean } from './sketch-window';
import type { RawImageData } from './trace-image';

const BACKGROUND_LUMA = 255;
const SKETCH_CONTRAST_BIAS = 8;

export function lumaCrackField(prepared: RawImageData, thresholdLuma: number): CrackSubPixelField {
  const { width, height } = prepared;
  const luma = lumaBuffer(prepared);
  return {
    thresholdAt: (): number => thresholdLuma,
    lumaAt: lumaReader(luma, width, height),
  };
}

// The sketch cut is luma < localMean − bias — a position-dependent
// threshold, exposed as thresholdAt so the walker interpolates raw luma
// against the local iso value. (Exact-equality pixels classify background in
// the mask; the walker's straddle check falls back to the midpoint there.)
export function sketchCrackField(adjusted: RawImageData, radiusPx: number): CrackSubPixelField {
  const { width, height } = adjusted;
  const luma = lumaBuffer(adjusted);
  const integral = integralLuma(luma, width, height);
  const thresholdAt = (x: number, y: number): number => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return localMean(integral, width, height, cx, cy, radiusPx) - SKETCH_CONTRAST_BIAS;
  };
  return {
    thresholdAt: registerBoxThreshold(thresholdAt, {
      width,
      height,
      integral,
      radius: radiusPx,
      bias: SKETCH_CONTRAST_BIAS,
    }),
    lumaAt: lumaReader(luma, width, height),
  };
}

function lumaReader(
  luma: Uint8Array,
  width: number,
  height: number,
): (x: number, y: number) => number {
  const lumaAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return BACKGROUND_LUMA;
    return luma[y * width + x] ?? BACKGROUND_LUMA;
  };
  return registerLumaPlane(lumaAt, { width, height, luma });
}

export function sketchTraceToMonochrome(image: RawImageData, radiusPx: number): RawImageData {
  const luma = lumaBuffer(image);
  const integral = integralLuma(luma, image.width, image.height);
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixel = y * image.width + x;
      const mean = localMean(integral, image.width, image.height, x, y, radiusPx);
      const v = (luma[pixel] ?? 255) < mean - SKETCH_CONTRAST_BIAS ? 0 : 255;
      const out = pixel * 4;
      data[out] = v;
      data[out + 1] = v;
      data[out + 2] = v;
      data[out + 3] = 255;
    }
  }
  return { width: image.width, height: image.height, data };
}

export function lumaBuffer(image: RawImageData): Uint8Array {
  const luma = new Uint8Array(image.width * image.height);
  const { data } = image;
  for (let pixel = 0, offset = 0; pixel < luma.length; pixel += 1, offset += 4) {
    const r = data[offset] ?? 255;
    const g = data[offset + 1] ?? 255;
    const b = data[offset + 2] ?? 255;
    luma[pixel] = r === g && g === b ? (GREY_LUMA[r] as number) : lumaByte(r, g, b);
  }
  return luma;
}

// lumaByte of every grey level: a prepared or scanned page is mostly grey.
const GREY_LUMA = Uint8Array.from({ length: 256 }, (_, v) => lumaByte(v, v, v));

export function lumaByte(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}
