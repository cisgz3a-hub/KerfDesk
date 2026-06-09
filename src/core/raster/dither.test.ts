import { describe, expect, it } from 'vitest';
import { DITHER_ALGORITHMS } from '../scene';
import { dither, type DitherAlgorithm, type DitherInput } from './dither';

// Helpers: build canonical greyscale fixtures so the tests read like
// the algorithm's intent.

function uniform(width: number, height: number, luma: number): DitherInput {
  const buf = new Uint8Array(width * height);
  buf.fill(luma);
  return { luma: buf, width, height };
}

function gradient(width: number, height: number): DitherInput {
  // Horizontal gradient: black on the left (luma=0), white on the
  // right (luma=255). Exercises every algorithm across the full
  // luma range in a single fixture.
  const buf = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      buf[y * width + x] = Math.round((x / Math.max(1, width - 1)) * 255);
    }
  }
  return { luma: buf, width, height };
}

const SMAX = 1000;
const BINARY_ALGORITHMS = DITHER_ALGORITHMS.filter(
  (algorithm): algorithm is Exclude<DitherAlgorithm, 'grayscale'> => algorithm !== 'grayscale',
);

describe('dither — threshold', () => {
  it('all-black input → every pixel at sMax', () => {
    const out = dither(uniform(8, 4, 0), { algorithm: 'threshold', sMax: SMAX });
    expect(Array.from(out).every((v) => v === SMAX)).toBe(true);
  });

  it('all-white input → every pixel at 0', () => {
    const out = dither(uniform(8, 4, 255), { algorithm: 'threshold', sMax: SMAX });
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('honours a custom thresholdLuma', () => {
    // Half-black (luma=64), half-white (luma=200), with threshold 100:
    // 64 < 100 → burn (sMax); 200 ≥ 100 → off (0).
    const buf = new Uint8Array([64, 64, 200, 200]);
    const out = dither(
      { luma: buf, width: 4, height: 1 },
      { algorithm: 'threshold', sMax: SMAX, thresholdLuma: 100 },
    );
    expect(Array.from(out)).toEqual([SMAX, SMAX, 0, 0]);
  });

  it('matches default 128 threshold when none provided', () => {
    const buf = new Uint8Array([127, 128, 129]);
    const out = dither({ luma: buf, width: 3, height: 1 }, { algorithm: 'threshold', sMax: SMAX });
    // 127 < 128 → burn; 128 ≥ 128 → off; 129 ≥ 128 → off.
    expect(Array.from(out)).toEqual([SMAX, 0, 0]);
  });
});

describe('dither — grayscale', () => {
  it('black → sMax, white → 0, mid-grey → ~sMax/2', () => {
    const buf = new Uint8Array([0, 128, 255]);
    const out = dither({ luma: buf, width: 3, height: 1 }, { algorithm: 'grayscale', sMax: SMAX });
    expect(out[0]).toBe(SMAX);
    expect(out[2]).toBe(0);
    // (255-128)/255 * 1000 = 498.04 → 498. Allow ±1 for rounding.
    expect(Math.abs((out[1] ?? 0) - 498)).toBeLessThanOrEqual(1);
  });

  it('honours sMin for non-white grayscale pixels while keeping white pixels off', () => {
    const floorOut = dither(
      { luma: new Uint8Array([0, 128, 254, 255]), width: 4, height: 1 },
      { algorithm: 'grayscale', sMax: SMAX, sMin: 100 },
    );
    expect(Array.from(floorOut)).toEqual([SMAX, 548, 104, 0]);
  });

  it('monotone output is non-increasing along the gradient', () => {
    const out = dither(gradient(16, 1), { algorithm: 'grayscale', sMax: SMAX });
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i]).toBeLessThanOrEqual(out[i - 1] ?? SMAX);
    }
  });
});

describe('dither — floyd-steinberg', () => {
  it('all-black input stays full-burn (no error to diffuse)', () => {
    const out = dither(uniform(8, 4, 0), { algorithm: 'floyd-steinberg', sMax: SMAX });
    expect(Array.from(out).every((v) => v === SMAX)).toBe(true);
  });

  it('all-white input stays off (no error to diffuse)', () => {
    const out = dither(uniform(8, 4, 255), { algorithm: 'floyd-steinberg', sMax: SMAX });
    expect(Array.from(out).every((v) => v === 0)).toBe(true);
  });

  it('output values are always exactly 0 or sMax (FS is binary)', () => {
    const out = dither(gradient(16, 16), { algorithm: 'floyd-steinberg', sMax: SMAX });
    for (const v of out) {
      expect(v === 0 || v === SMAX).toBe(true);
    }
  });

  it('mid-grey region produces a mix of burn / no-burn pixels', () => {
    // A 50% grey field, big enough that FS has room to diffuse — the
    // output should have roughly half the pixels burning. The exact
    // ratio is well-known: FS converges to the input average.
    const W = 32;
    const H = 32;
    const input = uniform(W, H, 128);
    const out = dither(input, { algorithm: 'floyd-steinberg', sMax: SMAX });
    const burns = Array.from(out).filter((v) => v === SMAX).length;
    const ratio = burns / out.length;
    // 128/255 = 0.502. Allow ±5% for FS quantization near the boundary.
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  it('is deterministic — same input gives byte-identical output', () => {
    const input = gradient(16, 16);
    const a = dither(input, { algorithm: 'floyd-steinberg', sMax: SMAX });
    const b = dither(input, { algorithm: 'floyd-steinberg', sMax: SMAX });
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('does not mutate the input buffer', () => {
    const buf = new Uint8Array([0, 64, 128, 192, 255]);
    const original = new Uint8Array(buf);
    dither({ luma: buf, width: 5, height: 1 }, { algorithm: 'floyd-steinberg', sMax: SMAX });
    expect(Array.from(buf)).toEqual(Array.from(original));
  });
});

describe('dither — expanded binary raster modes', () => {
  it.each(BINARY_ALGORITHMS)('%s keeps black full-burn and white off', (algorithm) => {
    const black = dither(uniform(4, 4, 0), { algorithm, sMax: SMAX });
    const white = dither(uniform(4, 4, 255), { algorithm, sMax: SMAX });
    expect(Array.from(black).every((v) => v === SMAX)).toBe(true);
    expect(Array.from(white).every((v) => v === 0)).toBe(true);
  });

  it.each(BINARY_ALGORITHMS)('%s emits only 0 or sMax values', (algorithm) => {
    const out = dither(gradient(16, 16), { algorithm, sMax: SMAX });
    for (const v of out) {
      expect(v === 0 || v === SMAX).toBe(true);
    }
  });

  it.each(BINARY_ALGORITHMS)('%s is deterministic', (algorithm) => {
    const input = gradient(16, 16);
    const a = dither(input, { algorithm, sMax: SMAX });
    const b = dither(input, { algorithm, sMax: SMAX });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
