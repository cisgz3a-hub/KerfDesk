// The local detector window of the Sketch, automatic-detail and Faint lines
// masks: its size on the working grid, and its box mean over an integral
// image. Split from trace-image.ts (the file line cap), which re-exports the
// sizing helpers.

import type { TraceOptions } from './trace-option-types';

/** Local-contrast window of sketch and auto-detail masks, in SOURCE pixels. */
export const SKETCH_RADIUS_PX = 8;

/** Sanitized supersampling factor (see TraceOptions.pixelScale). */
export function effectivePixelScale(options: TraceOptions): number {
  const scale = options.pixelScale ?? 1;
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

/** Working px per PREVIEW px for the local detector windows: the supersample
 * factor times a finer commit grid's ratio (TraceOptions.detectorWindowScale). */
export function detectorWindowScale(options: TraceOptions): number {
  const commit = options.detectorWindowScale ?? 1;
  return effectivePixelScale(options) * (Number.isFinite(commit) && commit >= 1 ? commit : 1);
}

/** The sketch / automatic-detail / faint-line window on this grid, in WHOLE
 * pixels: its box corners index the integral image, so a fractional radius
 * (a tapered supersample, ADR-438 Amendment 3) would read between cells.
 * Rounded as Edge Detection's window is (local-contrast-mask.ts). */
export function sketchWindowRadiusPx(options: TraceOptions): number {
  return Math.max(1, Math.round(SKETCH_RADIUS_PX * detectorWindowScale(options)));
}

/** Summed-area table of a luma plane, (width + 1) x (height + 1). */
export function integralLuma(luma: Uint8Array, width: number, height: number): Float64Array {
  const stride = width + 1;
  const integral = new Float64Array((height + 1) * stride);
  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      rowSum += luma[(y - 1) * width + (x - 1)] ?? 255;
      integral[y * stride + x] = (integral[(y - 1) * stride + x] ?? 0) + rowSum;
    }
  }
  return integral;
}

/** The box mean around a whole pixel with a whole-pixel radius. A read off the
 * integral image (a fractional or out-of-range corner) is a bug, so it throws
 * instead of counting as an empty box. */
export function localMean(
  integral: Float64Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  const x0 = Math.max(0, x - radius);
  const y0 = Math.max(0, y - radius);
  const x1 = Math.min(width, x + radius + 1);
  const y1 = Math.min(height, y + radius + 1);
  const stride = width + 1;
  const sum =
    (integral[y1 * stride + x1] as number) -
    (integral[y0 * stride + x1] as number) -
    (integral[y1 * stride + x0] as number) +
    (integral[y0 * stride + x0] as number);
  if (Number.isNaN(sum)) {
    throw new RangeError(`local mean box (${x0}, ${y0})-(${x1}, ${y1}) is off the integral grid`);
  }
  return sum / Math.max(1, (x1 - x0) * (y1 - y0));
}
