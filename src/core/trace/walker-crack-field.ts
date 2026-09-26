// Which sub-pixel crack field the contour walker gets (ADR-453, ADR-456).
// Split from trace-image.ts (file cap); pure functions.

import type { CrackSubPixelField } from './contour-boundary';
import { bandCrackField, withPlateauCrossing, type ScalarPlane } from './crack-iso-levels';
import type { RawImageData } from './trace-image';
import type { TraceOptions } from './trace-option-types';

function clampLuma(value: number): number {
  return Math.max(0, Math.min(255, value));
}

function pixelScaleOf(options: TraceOptions): number {
  const scale = options.pixelScale ?? 1;
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

// Edge placement for the contour walker only (ADR-453, ADR-456); the
// cleanup and recovery stages above keep reading `field`, so the mask and
// its topology are unchanged. A Cutoff > 0 band gets per-crack band edges;
// the automatic cut gets the local plateau mid-level on broad edges.
export function walkerCrackField(
  leveled: RawImageData,
  options: TraceOptions,
  thresholded: { readonly prepared: RawImageData; readonly thresholdLuma: number | null },
  field: CrackSubPixelField | null,
  lumaOf: (image: RawImageData) => Uint8Array,
): CrackSubPixelField | null {
  const lumaPlane = (image: RawImageData): ScalarPlane => ({
    width: image.width,
    height: image.height,
    values: lumaOf(image),
  });
  const cutoff = options.cutoffLuma;
  if (cutoff !== undefined && cutoff !== 0) {
    const upper = options.thresholdLuma ?? 128;
    const lo = clampLuma(Math.min(cutoff, upper));
    return bandCrackField(lumaPlane(leveled), lo, clampLuma(Math.max(cutoff, upper)));
  }
  const cut = thresholded.thresholdLuma;
  const automatic = options.useOtsuThreshold === true && options.thresholdLuma === undefined;
  if (field === null || cut === null || cutoff !== undefined || !automatic) return field;
  const { data } = thresholded.prepared;
  const ink = new Uint8Array(leveled.width * leveled.height);
  for (let p = 0; p < ink.length; p += 1) ink[p] = data[p * 4] === 0 ? 1 : 0;
  return withPlateauCrossing(field, lumaPlane(leveled), ink, cut, pixelScaleOf(options));
}

// The alpha route cuts 255 − alpha with the same band as luma (ADR-456).
export function alphaBandField(image: RawImageData, options: TraceOptions): CrackSubPixelField {
  const cutoff = options.cutoffLuma ?? 0;
  const threshold = options.thresholdLuma ?? 128;
  const values = new Uint8Array(image.width * image.height);
  for (let p = 0; p < values.length; p += 1) values[p] = 255 - (image.data[p * 4 + 3] ?? 255);
  const plane = { width: image.width, height: image.height, values };
  const lo = clampLuma(Math.min(cutoff, threshold));
  return bandCrackField(plane, lo, clampLuma(Math.max(cutoff, threshold)));
}
