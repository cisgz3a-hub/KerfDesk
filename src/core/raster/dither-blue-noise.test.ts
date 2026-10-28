import { describe, expect, it } from 'vitest';
import { dither } from './dither';
import {
  blueNoiseCoefficients,
  blueNoiseModulation,
  blueNoiseThreshold,
  thresholdNoise,
} from './dither-blue-noise';
import { BLUE_NOISE_KEY_LEVELS, OSTROMOUKHOV_2001_WEIGHTS } from './dither-blue-noise-tables';

const S_MAX = 1000;
const LEVELS = Array.from({ length: 256 }, (_, level) => level);

function blueNoise(luma: Uint8Array, width: number, height: number): Float64Array {
  return dither({ luma, width, height }, { algorithm: 'blue-noise', sMax: S_MAX });
}

describe('blue-noise weight tables', () => {
  it('holds all 128 published rows and joins the tuned key levels where they start', () => {
    expect(OSTROMOUKHOV_2001_WEIGHTS).toHaveLength(128);
    for (const row of OSTROMOUKHOV_2001_WEIGHTS) {
      expect(row.every((weight) => Number.isInteger(weight) && weight >= 0)).toBe(true);
      expect(row[0] + row[1] + row[2]).toBeGreaterThan(0);
    }
    // The first key level repeats the published row, so the weights run on
    // without a step where the published table hands over to the tuned one.
    const first = BLUE_NOISE_KEY_LEVELS[0]!;
    expect(first.weights).toEqual(OSTROMOUKHOV_2001_WEIGHTS[first.level]);
    expect(first.modulation).toBe(0);
    const levels = BLUE_NOISE_KEY_LEVELS.map((key) => key.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(levels.at(-1)).toBe(127);
  });

  it('gives every level weights that sum to 1, mirrored between dark and light', () => {
    for (const level of LEVELS) {
      const c = blueNoiseCoefficients(level);
      expect(Math.min(c.ahead, c.behindBelow, c.below)).toBeGreaterThanOrEqual(0);
      expect(c.ahead + c.behindBelow + c.below).toBeCloseTo(1, 12);
      expect(blueNoiseCoefficients(255 - level)).toEqual(c);
      expect(blueNoiseModulation(255 - level)).toBe(blueNoiseModulation(level));
    }
  });

  it('keeps every threshold inside (0, 255] so solid black burns and solid white does not', () => {
    for (const level of LEVELS) {
      const strength = blueNoiseModulation(level);
      expect(strength).toBeGreaterThanOrEqual(0);
      expect(128 - strength).toBeGreaterThan(0);
      expect(128 + strength).toBeLessThanOrEqual(255);
    }
    // Highlights and shadows run the published scheme with a fixed threshold.
    expect(blueNoiseThreshold(17, 3, 10)).toBe(128);
    expect(blueNoiseThreshold(17, 3, 245)).toBe(128);
  });
});

describe('blue-noise threshold noise', () => {
  it('is a pure function of the pixel position, spread evenly over [-1, 1)', () => {
    const bins = new Array<number>(10).fill(0);
    let sum = 0;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let repeatable = true;
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < 256; x += 1) {
        const n = thresholdNoise(x, y);
        repeatable &&= thresholdNoise(x, y) === n;
        min = Math.min(min, n);
        max = Math.max(max, n);
        sum += n;
        bins[Math.floor((n + 1) * 5)]! += 1;
      }
    }
    expect(repeatable).toBe(true);
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThan(1);
    expect(Math.abs(sum / 65_536)).toBeLessThan(0.01);
    for (const count of bins) expect(Math.abs(count / 6_553.6 - 1)).toBeLessThan(0.05);
    // Neighbours are unrelated, not a smooth field.
    expect(thresholdNoise(0, 0)).not.toBe(thresholdNoise(1, 0));
    expect(thresholdNoise(0, 0)).not.toBe(thresholdNoise(0, 1));
  });
});

describe('dither — blue-noise', () => {
  it('reproduces the same burn for the same image and leaves the input untouched', () => {
    const width = 61;
    const height = 37;
    const luma = Uint8Array.from({ length: width * height }, (_, i) => (i * 97 + (i >> 3)) % 256);
    const before = Uint8Array.from(luma);
    const first = blueNoise(luma, width, height);
    expect(blueNoise(luma, width, height)).toEqual(first);
    expect(luma).toEqual(before);
    expect(Array.from(first).every((s) => s === 0 || s === S_MAX)).toBe(true);
  });

  it('burns solid black fully and leaves solid white off', () => {
    const black = blueNoise(new Uint8Array(40 * 9), 40, 9);
    const white = blueNoise(new Uint8Array(40 * 9).fill(255), 40, 9);
    expect(black.every((s) => s === S_MAX)).toBe(true);
    expect(white.every((s) => s === 0)).toBe(true);
  });

  // Quality audit Q3-P3-1: a pixel's weights follow its own level, so a white
  // pixel beside light grey could gather more than one neighbour's worth of
  // error and burn. Compile whitens a mask's outside before the dither, so
  // those dots landed outside the mask (ADR-480: it never burns); holes
  // appeared in solid black beside dark grey the same way.
  it('never burns white or skips black beside a grey disc', () => {
    const size = 96;
    const radius = 40;
    const inside = (i: number) =>
      ((i % size) + 0.5 - size / 2) ** 2 + (Math.floor(i / size) + 0.5 - size / 2) ** 2 <
      radius ** 2;
    for (const [disc, field] of [
      ...[200, 230, 240, 245, 250, 253].map((level) => [level, 255] as const),
      ...[2, 5, 10, 15, 20, 25].map((level) => [level, 0] as const),
    ]) {
      const luma = Uint8Array.from({ length: size * size }, (_, i) => (inside(i) ? disc : field));
      const burn = blueNoise(luma, size, size);
      const outside = Array.from(burn).filter((_, i) => !inside(i));
      expect(outside.every((s) => s === (field === 0 ? S_MAX : 0))).toBe(true);
    }
  });

  it('follows a ramp: each band burns its own tone and lighter bands burn less', () => {
    const width = 512;
    const height = 96;
    const luma = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) luma[y * width + x] = Math.floor(x / 2);
    }
    const burn = blueNoise(luma, width, height);
    const bands = 16;
    const bandWidth = width / bands;
    let previous = Number.POSITIVE_INFINITY;
    for (let band = 0; band < bands; band += 1) {
      let burned = 0;
      let wanted = 0;
      // Skip the first rows while error builds up, as a burn would.
      for (let y = 16; y < height; y += 1) {
        for (let x = band * bandWidth; x < (band + 1) * bandWidth; x += 1) {
          burned += burn[y * width + x] === S_MAX ? 1 : 0;
          wanted += (255 - (luma[y * width + x] ?? 255)) / 255;
        }
      }
      const pixels = (height - 16) * bandWidth;
      expect(Math.abs(burned - wanted) / pixels).toBeLessThan(0.02);
      expect(burned).toBeLessThan(previous);
      previous = burned;
    }
  });
});
