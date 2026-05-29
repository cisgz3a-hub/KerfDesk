// Unit tests for the LF1-ported preprocessing levers in raster-prep.ts.
// Each function is a pure RGBA→RGBA transform; we check identity at the
// no-op value, the direction of effect at a non-trivial value, and the
// immutability invariant (input buffer not mutated).

import { describe, expect, it } from 'vitest';

import { adjustBrightness, adjustContrast, adjustGamma, invertImage } from './raster-prep';
import type { RawImageData } from './trace-image';

// Construct a single-pixel test image at the given grey value (R=G=B).
function greyPixel(v: number): RawImageData {
  const data = new Uint8ClampedArray(4);
  data[0] = v;
  data[1] = v;
  data[2] = v;
  data[3] = 255;
  return { width: 1, height: 1, data };
}

// Construct a 2-pixel image: pixel 0 black (0), pixel 1 white (255).
// Useful for "+brightness lifts black to non-zero, leaves white at 255".
function blackWhiteRow(): RawImageData {
  const data = new Uint8ClampedArray(8);
  data[0] = 0;
  data[1] = 0;
  data[2] = 0;
  data[3] = 255;
  data[4] = 255;
  data[5] = 255;
  data[6] = 255;
  data[7] = 255;
  return { width: 2, height: 1, data };
}

describe('adjustBrightness', () => {
  it('returns the input unchanged when brightness is 0', () => {
    const input = greyPixel(128);
    const output = adjustBrightness(input, 0);
    expect(output).toBe(input);
  });

  it('shifts every channel up by brightness * 2.55 (clamped)', () => {
    const input = greyPixel(100);
    const output = adjustBrightness(input, 10);
    // 100 + 10 * 2.55 = 125.5 → 126 after rounding.
    expect(output.data[0]).toBe(126);
    expect(output.data[1]).toBe(126);
    expect(output.data[2]).toBe(126);
    expect(output.data[3]).toBe(255);
  });

  it('saturates a black pixel to white at +100', () => {
    const input = greyPixel(0);
    const output = adjustBrightness(input, 100);
    expect(output.data[0]).toBe(255);
    expect(output.data[1]).toBe(255);
    expect(output.data[2]).toBe(255);
  });

  it('clamps below 0 at −100 (black stays black, white drops)', () => {
    const input = blackWhiteRow();
    const output = adjustBrightness(input, -100);
    expect(output.data[0]).toBe(0); // black stays black
    expect(output.data[4]).toBe(0); // white → 255 − 255 = 0 after delta
  });

  it('does not mutate the input buffer', () => {
    const input = greyPixel(50);
    const before = Array.from(input.data);
    adjustBrightness(input, 25);
    expect(Array.from(input.data)).toEqual(before);
  });
});

describe('adjustContrast', () => {
  it('returns the input unchanged when contrast is 0', () => {
    const input = greyPixel(50);
    const output = adjustContrast(input, 0);
    expect(output).toBe(input);
  });

  it('collapses every pixel to 128 at contrast = −100', () => {
    const input = blackWhiteRow();
    const output = adjustContrast(input, -100);
    // factor = 0 → output is just 128 everywhere.
    expect(output.data[0]).toBe(128);
    expect(output.data[4]).toBe(128);
  });

  it('doubles contrast at +100 (pulls dark darker, light lighter)', () => {
    // 100 → (100 - 128) * 2 + 128 = 72
    const input = greyPixel(100);
    const output = adjustContrast(input, 100);
    expect(output.data[0]).toBe(72);
    // 160 → (160 - 128) * 2 + 128 = 192
    const input2 = greyPixel(160);
    const output2 = adjustContrast(input2, 100);
    expect(output2.data[0]).toBe(192);
  });

  it('does not mutate the input buffer', () => {
    const input = greyPixel(180);
    const before = Array.from(input.data);
    adjustContrast(input, 50);
    expect(Array.from(input.data)).toEqual(before);
  });
});

describe('adjustGamma', () => {
  it('returns the input unchanged when gamma is 1', () => {
    const input = greyPixel(128);
    const output = adjustGamma(input, 1);
    expect(output).toBe(input);
  });

  it('brightens midtones when gamma > 1', () => {
    // Midpoint 128 → (128/255) ^ (1/2) * 255 ≈ 180.4 → 180
    const input = greyPixel(128);
    const output = adjustGamma(input, 2);
    expect(output.data[0]).toBeGreaterThan(128);
  });

  it('darkens midtones when gamma < 1', () => {
    const input = greyPixel(128);
    const output = adjustGamma(input, 0.5);
    expect(output.data[0]).toBeLessThan(128);
  });

  it('clamps gamma below 0.1 to 0.1 (no divide-by-zero)', () => {
    const input = greyPixel(128);
    // Should not throw or produce NaN — equivalent to gamma=0.1.
    const output = adjustGamma(input, 0);
    const reference = adjustGamma(input, 0.1);
    expect(output.data[0]).toBe(reference.data[0]);
  });

  it('clamps gamma above 5 to 5', () => {
    const input = greyPixel(128);
    const output = adjustGamma(input, 99);
    const reference = adjustGamma(input, 5);
    expect(output.data[0]).toBe(reference.data[0]);
  });

  it('preserves 0 and 255 endpoints regardless of gamma', () => {
    const input = blackWhiteRow();
    const output = adjustGamma(input, 2.5);
    expect(output.data[0]).toBe(0);
    expect(output.data[4]).toBe(255);
  });

  it('does not mutate the input buffer', () => {
    const input = greyPixel(128);
    const before = Array.from(input.data);
    adjustGamma(input, 2);
    expect(Array.from(input.data)).toEqual(before);
  });
});

describe('invertImage', () => {
  it('flips black to white and white to black', () => {
    const input = blackWhiteRow();
    const output = invertImage(input);
    expect(output.data[0]).toBe(255);
    expect(output.data[1]).toBe(255);
    expect(output.data[2]).toBe(255);
    expect(output.data[3]).toBe(255); // alpha preserved
    expect(output.data[4]).toBe(0);
    expect(output.data[5]).toBe(0);
    expect(output.data[6]).toBe(0);
    expect(output.data[7]).toBe(255); // alpha preserved
  });

  it('is its own inverse (involutive)', () => {
    const input = greyPixel(77);
    const twice = invertImage(invertImage(input));
    expect(twice.data[0]).toBe(77);
    expect(twice.data[1]).toBe(77);
    expect(twice.data[2]).toBe(77);
  });

  it('does not mutate the input buffer', () => {
    const input = greyPixel(100);
    const before = Array.from(input.data);
    invertImage(input);
    expect(Array.from(input.data)).toEqual(before);
  });
});

describe('composition with the existing preprocess chain', () => {
  // The whole point of these four ops is to feed cleaner pixels into
  // medianFilter → otsuThreshold → despeckle. A useful smoke check:
  // a low-contrast grey image should, after a strong contrast bump,
  // contain pixels at both ends of the range.
  it('contrast push opens up a flat-grey input', () => {
    const data = new Uint8ClampedArray(16);
    // 4 pixels all at 120–135 (very low contrast).
    [120, 125, 130, 135].forEach((v, i) => {
      const o = i * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    });
    const input: RawImageData = { width: 4, height: 1, data };
    const output = adjustContrast(input, 100);
    const values = [output.data[0], output.data[4], output.data[8], output.data[12]];
    const min = Math.min(...(values as number[]));
    const max = Math.max(...(values as number[]));
    // After 2x contrast around pivot 128, the spread doubles.
    expect(max - min).toBeGreaterThan(15);
  });
});
