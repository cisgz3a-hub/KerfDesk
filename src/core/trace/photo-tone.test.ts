import { describe, expect, it } from 'vitest';
import type { ColoredPath } from '../scene';
import { photoToneLookup, srgbByteToLinear } from './photo-tone';
import { DEFAULT_TRACE_OPTIONS, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const neutral: TraceOptions = DEFAULT_TRACE_OPTIONS;
const BYTES = Array.from({ length: 256 }, (_, value) => value);

describe('sRGB decoding', () => {
  it('decodes black and white exactly and joins its two pieces at the knee', () => {
    expect(srgbByteToLinear(0)).toBe(0);
    expect(srgbByteToLinear(255)).toBe(1);
    // 10/255 lies on the linear toe, 11/255 on the power curve.
    expect(srgbByteToLinear(10)).toBeCloseTo(10 / 255 / 12.92, 15);
    expect(srgbByteToLinear(11)).toBeCloseTo(((11 / 255 + 0.055) / 1.055) ** 2.4, 15);
    for (const value of BYTES.slice(1)) {
      expect(srgbByteToLinear(value)).toBeGreaterThan(srgbByteToLinear(value - 1));
    }
  });

  it('puts sRGB 128 at 21.6% of white and 50% of white between 187 and 188', () => {
    expect(srgbByteToLinear(64)).toBeCloseTo(0.051269, 6);
    expect(srgbByteToLinear(128)).toBeCloseTo(0.215861, 6);
    expect(srgbByteToLinear(192)).toBeCloseTo(0.527115, 6);
    expect(srgbByteToLinear(187)).toBeLessThan(0.5);
    expect(srgbByteToLinear(188)).toBeGreaterThan(0.5);
  });
});

describe('photo tone lookup', () => {
  it('gives each byte one minus its linear light by default, with gamma 1 neutral', () => {
    const tone = photoToneLookup(neutral);
    expect(tone).toHaveLength(256);
    for (const value of BYTES) expect(tone[value]).toBe(1 - srgbByteToLinear(value));
    expect(photoToneLookup({ ...neutral, gamma: 1, brightness: 0, contrast: 0 })).toEqual(tone);
    expect(photoToneLookup({ ...neutral, invert: false })).toEqual(tone);
  });

  it('inverts in linear light, so lines follow the photo luminance', () => {
    const tone = photoToneLookup({ ...neutral, invert: true });
    for (const value of BYTES) expect(tone[value]).toBe(srgbByteToLinear(value));
    // A deep shadow gets 5% coverage, where inverting the byte would give 48%.
    expect(tone[64]).toBeCloseTo(0.0513, 4);
  });

  it('keeps gamma, brightness and contrast directions on the photo', () => {
    const base = photoToneLookup(neutral);
    const lighter = photoToneLookup({ ...neutral, gamma: 1.8 });
    const darker = photoToneLookup({ ...neutral, gamma: 0.6 });
    const brighter = photoToneLookup({ ...neutral, brightness: 20 });
    const contrast = photoToneLookup({ ...neutral, contrast: 40 });
    for (const value of [32, 96, 128, 160, 224]) {
      expect(lighter[value]).toBeLessThan(base[value]!);
      expect(darker[value]).toBeGreaterThan(base[value]!);
      expect(brighter[value]).toBeLessThan(base[value]!);
    }
    expect(contrast[64]).toBeGreaterThan(base[64]!);
    expect(contrast[192]).toBeLessThan(base[192]!);
    // Gamma and contrast keep solid black and bare white; brightness lifts black.
    for (const tone of [lighter, darker, contrast]) {
      expect(tone[0]).toBe(1);
      expect(tone[255]).toBe(0);
    }
    expect(brighter[0]).toBeCloseTo(1 - srgbByteToLinear(51), 12);
  });

  it('lets gamma 2.2 approximate the previous byte-proportional response', () => {
    const tone = photoToneLookup({ ...neutral, gamma: 2.2 });
    for (const value of BYTES) {
      expect(Math.abs(tone[value]! - (1 - value / 255))).toBeLessThan(0.012);
    }
  });

  it('treats non-finite tone options as neutral', () => {
    expect(
      photoToneLookup({ ...neutral, brightness: NaN, contrast: Infinity, gamma: -Infinity }),
    ).toEqual(photoToneLookup(neutral));
  });
});

// The 2026-09-24 audit's 11-step ramp: 440 x 120 px, steps 40 px wide.
const RAMP_STEPS = [0, 25, 51, 76, 102, 128, 153, 178, 204, 229, 255] as const;

function greyRamp(): RawImageData {
  const width = 440;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = RAMP_STEPS[Math.floor(x / 40)]!;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

// Ink width on one scan row between x0 and x1. Ribbons are vertical strips,
// so each crosses the row once on each side.
function inkBetween(paths: readonly ColoredPath[], y: number, x0: number, x1: number): number {
  let ink = 0;
  for (const line of paths.flatMap((path) => path.polylines)) {
    const crossings: number[] = [];
    for (let i = 0; i < line.points.length; i += 1) {
      const a = line.points[i]!;
      const b = line.points[(i + 1) % line.points.length]!;
      if (a.y > y === b.y > y) continue;
      crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    if (crossings.length !== 2) continue;
    const [left, right] = crossings.sort((a, b) => a - b) as [number, number];
    ink += Math.max(0, Math.min(right, x1) - Math.max(left, x0));
  }
  return ink;
}

describe('Photo shading grey ramp', () => {
  it('gives every step the coverage that reproduces its linear-light tone', async () => {
    const ramp = greyRamp();
    const paths = await traceImageToColoredPaths(ramp, TRACE_PRESETS['Photo shading']!);
    // Whole ribbon columns inside each step; 211 columns at the default Detail.
    const pitch = ramp.width / 211;
    const measured = RAMP_STEPS.map((_, step) => {
      const x0 = Math.ceil((step * 40) / pitch - 1e-9) * pitch;
      const x1 = Math.floor(((step + 1) * 40) / pitch + 1e-9) * pitch;
      return (inkBetween(paths, 60.25, x0, x1) / (x1 - x0)) * 100;
    });
    // Percent coverage the audit found each shade needs: 1 - linear(sRGB).
    const needed = [100, 99.0, 96.7, 92.8, 86.7, 78.4, 68.2, 55.5, 39.6, 21.6, 0];
    measured.forEach((coverage, step) => {
      expect(coverage).toBeCloseTo(needed[step]!, 0);
      expect(coverage / 100).toBeCloseTo(1 - srgbByteToLinear(RAMP_STEPS[step]!), 10);
    });
  });
});
