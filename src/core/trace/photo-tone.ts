// Photo shading tone in linear light (ADR-390). A ribbon's share of its cell
// sets how much light the cell reflects, and by the Murray–Davies relation
// reflectance is linear in the inked area. Coverage therefore has to follow
// the photo's luminance in linear light, not its stored sRGB bytes: sRGB 128
// is 21.6% of white, so it needs 78% coverage where 1 − 128/255 gives 50%.
import { finiteOr } from '../util';
import { adjustBrightness, adjustContrast, adjustGamma } from './raster-prep';
import type { RawImageData, TraceOptions } from './trace-image';

/**
 * Decodes one 8-bit sRGB channel to linear light with the exact piecewise
 * transfer function of IEC 61966-2-1, as published in CSS Color 4.
 * 0 decodes to exactly 0 and 255 to exactly 1.
 */
export function srgbByteToLinear(value: number): number {
  const encoded = value / 255;
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

/**
 * Per-channel darkness in linear light, 0 for white and 1 for black, for
 * every 8-bit value after the photo's tone adjustments. Weighting the three
 * channel darknesses by the Rec. 709 luminance weights gives one minus the
 * pixel's relative luminance, which is the ink coverage its area needs.
 * Sampling reads this 256-entry table, so adjustments never allocate a copy
 * of the photo.
 */
export function photoToneLookup(options: TraceOptions): Float64Array {
  const data = new Uint8ClampedArray(256 * 4);
  for (let value = 0; value < 256; value += 1) {
    data.fill(value, value * 4, value * 4 + 3);
    data[value * 4 + 3] = 255;
  }
  // Brightness, contrast and gamma keep the byte maths every trace shares, so
  // 0, 0 and 1 stay exact no-ops and each control keeps its direction. Gamma 1
  // is neutral because the decode below already gives the photo's own tone.
  let ramp: RawImageData = { width: 256, height: 1, data };
  ramp = adjustBrightness(ramp, finiteOr(options.brightness ?? 0, 0));
  ramp = adjustContrast(ramp, finiteOr(options.contrast ?? 0, 0));
  ramp = adjustGamma(ramp, finiteOr(options.gamma ?? 1, 1));
  // Invert swaps light and dark in linear light, so the lines follow the
  // photo's luminance: the coverage a material that marks lighter than its
  // surface needs. Inverting the bytes instead would give a deep shadow
  // (sRGB 64) 48% coverage rather than 5%.
  const invert = options.invert === true;
  const darkness = new Float64Array(256);
  for (let value = 0; value < 256; value += 1) {
    const linear = srgbByteToLinear(ramp.data[value * 4] ?? 0);
    darkness[value] = invert ? linear : 1 - linear;
  }
  return darkness;
}
