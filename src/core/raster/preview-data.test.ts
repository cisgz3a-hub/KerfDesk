import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rasterPreviewRgba } from './preview-data';

const SMAX = 1000;
const MAX_CHANNEL = 255;
const FUZZ_RUNS = 100;

function grayAt(rgba: Uint8ClampedArray, pixelIndex: number): number {
  // All three color channels are equal (grayscale); read red.
  return rgba[pixelIndex * 4] ?? -1;
}

describe('rasterPreviewRgba', () => {
  it('S=0 (no burn) renders white', () => {
    const out = rasterPreviewRgba(new Uint16Array([0]), SMAX, 1, 1);
    expect(grayAt(out, 0)).toBe(MAX_CHANNEL);
  });

  it('S=sMax (full burn) renders black', () => {
    const out = rasterPreviewRgba(new Uint16Array([SMAX]), SMAX, 1, 1);
    expect(grayAt(out, 0)).toBe(0);
  });

  it('S=sMax/2 renders mid-gray', () => {
    const out = rasterPreviewRgba(new Uint16Array([SMAX / 2]), SMAX, 1, 1);
    // 255 - round(255 * 0.5) = 255 - 128 = 127.
    expect(grayAt(out, 0)).toBe(127);
  });

  it('sMax=0 (zero power) renders the whole image white', () => {
    const out = rasterPreviewRgba(new Uint16Array([0, SMAX, 500]), 0, 3, 1);
    expect([grayAt(out, 0), grayAt(out, 1), grayAt(out, 2)]).toEqual([
      MAX_CHANNEL,
      MAX_CHANNEL,
      MAX_CHANNEL,
    ]);
  });

  it('every pixel is fully opaque', () => {
    const out = rasterPreviewRgba(new Uint16Array([0, 250, 750, SMAX]), SMAX, 2, 2);
    for (let i = 0; i < 4; i += 1) expect(out[i * 4 + 3]).toBe(MAX_CHANNEL);
  });

  it('buffer length is width*height*4', () => {
    const out = rasterPreviewRgba(new Uint16Array(12), SMAX, 4, 3);
    expect(out.length).toBe(4 * 3 * 4);
  });

  it('missing S-values (short buffer) degrade to white, not a throw', () => {
    // noUncheckedIndexedAccess: a buffer shorter than width*height pads
    // with S=0 → white, matching "no data = no burn".
    const out = rasterPreviewRgba(new Uint16Array([SMAX]), SMAX, 2, 1);
    expect(grayAt(out, 1)).toBe(MAX_CHANNEL);
  });

  it('is monotonic: higher S never renders lighter than lower S', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: SMAX }),
        fc.integer({ min: 0, max: SMAX }),
        (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const out = rasterPreviewRgba(new Uint16Array([lo, hi]), SMAX, 2, 1);
          // More power (hi) ⇒ darker ⇒ gray no greater than the lo pixel.
          return grayAt(out, 1) <= grayAt(out, 0);
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });
});
