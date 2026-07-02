// Image gradient for the Canny edge detector (ADR-059): grayscale -> Gaussian
// blur (noise suppression) -> Sobel gradient (magnitude + raw components for
// interpolating non-max suppression).
// Pure-core and deterministic. Textbook math (Canny 1986); not derived from any
// GPL/third-party source.

import type { RawImageData } from './trace-image';

export type Gradient = {
  readonly mag: Float32Array;
  // Raw Sobel components — non-max suppression interpolates along the TRUE
  // gradient direction (bucketed comparisons starve diagonal ridges).
  readonly gradX: Float32Array;
  readonly gradY: Float32Array;
  readonly width: number;
  readonly height: number;
};

export function computeGradient(image: RawImageData, blurSigma: number): Gradient {
  const { width, height } = image;
  const gray = toGrayscale(image);
  const smoothed = blurSigma > 0 ? gaussianBlur(gray, width, height, blurSigma) : gray;
  return sobelGradient(smoothed, width, height);
}

function toGrayscale(image: RawImageData): Float32Array {
  const out = new Float32Array(image.width * image.height);
  for (let i = 0; i < out.length; i += 1) {
    const o = i * 4;
    out[i] =
      0.299 * (image.data[o] ?? 0) +
      0.587 * (image.data[o + 1] ?? 0) +
      0.114 * (image.data[o + 2] ?? 0);
  }
  return out;
}

function gaussianBlur(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  const kernel = gaussianKernel(sigma);
  const radius = (kernel.length - 1) / 2;
  const horizontal = convolve1d(src, width, height, kernel, radius, true);
  return convolve1d(horizontal, width, height, kernel, radius, false);
}

function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = 0; i < kernel.length; i += 1) {
    const x = i - radius;
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel[i] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i += 1) kernel[i] = (kernel[i] ?? 0) / sum;
  return kernel;
}

function convolve1d(
  src: Float32Array,
  width: number,
  height: number,
  kernel: Float32Array,
  radius: number,
  horizontal: boolean,
): Float32Array {
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let t = -radius; t <= radius; t += 1) {
        const sx = horizontal ? clamp(x + t, width) : x;
        const sy = horizontal ? y : clamp(y + t, height);
        acc += (src[sy * width + sx] ?? 0) * (kernel[t + radius] ?? 0);
      }
      out[y * width + x] = acc;
    }
  }
  return out;
}

function sobelGradient(src: Float32Array, width: number, height: number): Gradient {
  const mag = new Float32Array(width * height);
  const gradX = new Float32Array(width * height);
  const gradY = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        at(src, i - width + 1) +
        2 * at(src, i + 1) +
        at(src, i + width + 1) -
        at(src, i - width - 1) -
        2 * at(src, i - 1) -
        at(src, i + width - 1);
      const gy =
        at(src, i + width - 1) +
        2 * at(src, i + width) +
        at(src, i + width + 1) -
        at(src, i - width - 1) -
        2 * at(src, i - width) -
        at(src, i - width + 1);
      mag[i] = Math.hypot(gx, gy);
      gradX[i] = gx;
      gradY[i] = gy;
    }
  }
  return { mag, gradX, gradY, width, height };
}

function at(src: Float32Array, i: number): number {
  return src[i] ?? 0;
}

function clamp(v: number, size: number): number {
  return v < 0 ? 0 : v >= size ? size - 1 : v;
}
