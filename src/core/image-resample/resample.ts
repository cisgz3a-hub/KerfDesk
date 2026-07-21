// Whole-buffer resampling for the Image Studio (ADR-242, PP-E Image Size).
//
// Bilinear inverse mapping, preceded by 2×2 box halving while the source is
// more than twice the target on either axis — the mipmap trick that keeps
// heavy downscales (20 MP photo → engrave resolution) from aliasing the way
// naive bilinear does. Upscales are plain bilinear.

import { RGBA_CHANNELS, type RgbaBuffer } from '../image-edit';

const MIN_DIMENSION_PX = 1;
const HALVING_THRESHOLD = 2;

/** Resample to exactly width × height (floored, min 1 px). Returns a new buffer. */
export function resampleBuffer(source: RgbaBuffer, width: number, height: number): RgbaBuffer {
  const w = Math.max(MIN_DIMENSION_PX, Math.floor(width));
  const h = Math.max(MIN_DIMENSION_PX, Math.floor(height));
  let current = source;
  while (current.width >= w * HALVING_THRESHOLD && current.height >= h * HALVING_THRESHOLD) {
    current = halve(current);
  }
  if (current.width === w && current.height === h) {
    return { width: w, height: h, data: new Uint8ClampedArray(current.data) };
  }
  return bilinear(current, w, h);
}

// 2×2 box average; odd trailing rows/columns clamp their second tap.
function halve(source: RgbaBuffer): RgbaBuffer {
  const w = Math.max(MIN_DIMENSION_PX, Math.floor(source.width / 2));
  const h = Math.max(MIN_DIMENSION_PX, Math.floor(source.height / 2));
  const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
  for (let y = 0; y < h; y += 1) {
    const sy0 = y * 2;
    const sy1 = Math.min(source.height - 1, sy0 + 1);
    for (let x = 0; x < w; x += 1) {
      const sx0 = x * 2;
      const sx1 = Math.min(source.width - 1, sx0 + 1);
      const out = (y * w + x) * RGBA_CHANNELS;
      for (let c = 0; c < RGBA_CHANNELS; c += 1) {
        data[out + c] = Math.round(
          ((source.data[(sy0 * source.width + sx0) * RGBA_CHANNELS + c] ?? 0) +
            (source.data[(sy0 * source.width + sx1) * RGBA_CHANNELS + c] ?? 0) +
            (source.data[(sy1 * source.width + sx0) * RGBA_CHANNELS + c] ?? 0) +
            (source.data[(sy1 * source.width + sx1) * RGBA_CHANNELS + c] ?? 0)) /
            4,
        );
      }
    }
  }
  return { width: w, height: h, data };
}

function bilinear(source: RgbaBuffer, w: number, h: number): RgbaBuffer {
  const data = new Uint8ClampedArray(w * h * RGBA_CHANNELS);
  const scaleX = source.width / w;
  const scaleY = source.height / h;
  for (let y = 0; y < h; y += 1) {
    const sy = Math.max(0, (y + 0.5) * scaleY - 0.5);
    const y0 = Math.min(source.height - 1, Math.floor(sy));
    const y1 = Math.min(source.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < w; x += 1) {
      const sx = Math.max(0, (x + 0.5) * scaleX - 0.5);
      const x0 = Math.min(source.width - 1, Math.floor(sx));
      const x1 = Math.min(source.width - 1, x0 + 1);
      const fx = sx - x0;
      writePixel(source, data, { w, x, y, x0, x1, y0, y1, fx, fy });
    }
  }
  return { width: w, height: h, data };
}

type TapSpec = {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly fx: number;
  readonly fy: number;
};

function writePixel(source: RgbaBuffer, data: Uint8ClampedArray, spec: TapSpec): void {
  const base00 = (spec.y0 * source.width + spec.x0) * RGBA_CHANNELS;
  const base10 = (spec.y0 * source.width + spec.x1) * RGBA_CHANNELS;
  const base01 = (spec.y1 * source.width + spec.x0) * RGBA_CHANNELS;
  const base11 = (spec.y1 * source.width + spec.x1) * RGBA_CHANNELS;
  const out = (spec.y * spec.w + spec.x) * RGBA_CHANNELS;
  for (let c = 0; c < RGBA_CHANNELS; c += 1) {
    const top =
      (source.data[base00 + c] ?? 0) * (1 - spec.fx) + (source.data[base10 + c] ?? 0) * spec.fx;
    const bottom =
      (source.data[base01 + c] ?? 0) * (1 - spec.fx) + (source.data[base11 + c] ?? 0) * spec.fx;
    data[out + c] = Math.round(top * (1 - spec.fy) + bottom * spec.fy);
  }
}
