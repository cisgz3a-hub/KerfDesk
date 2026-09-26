import { afterEach, describe, expect, it, vi } from 'vitest';
import { downscaleTracedPaths, upscaleBy } from './auto-upscale';
import { edgeTraceInputMatches, prepareEdgeTraceInput } from './edge-input';
import { traceImageToEdgePaths, traceImageToEdgePathsSteps } from './edge-trace';
import { localContrastCrackField, localContrastInkBitmap } from './local-contrast-mask';
import * as localContrast from './local-contrast-mask';
import * as preprocess from './preprocess';
import { TRACE_PRESETS } from './trace-presets';
import { runTraceSteps } from './trace-steps';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';
import type { RawImageData } from './trace-image';
import type { ColoredPath } from '../scene';

const edge = TRACE_PRESETS['Edge Detection']!;
const paper = (size: number): RawImageData => ({
  width: size,
  height: size,
  data: new Uint8ClampedArray(size * size * 4).fill(255),
});
function paint(image: RawImageData, x: number, y: number, value: number): void {
  const i = (y * image.width + x) * 4;
  image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
}

afterEach(() => vi.restoreAllMocks());

describe('prepared Edge input', () => {
  it('shares a consistent bitmap and local threshold field for coloured and transparent pixels', () => {
    const image = paper(40);
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++) {
        const offset = (y * 40 + x) * 4;
        image.data[offset] = (x * 11 + y * 3) % 256;
        image.data[offset + 1] = (x * 7 + y * 13) % 256;
        image.data[offset + 2] = (x * 3 + y * 17) % 256;
        if (x < 5) image.data[offset + 3] = 0;
      }
    const before = new Uint8ClampedArray(image.data);
    const input = prepareEdgeTraceInput(image, { ...edge, edgeMedianFilter: false });
    const field = localContrastCrackField(image, input.maskOptions);
    expect(input.bitmap).toEqual(localContrastInkBitmap(image, input.maskOptions));
    for (let y = 0; y < 40; y++)
      for (let x = 0; x < 40; x++) {
        expect(input.crackField.lumaAt(x, y)).toBe(field.lumaAt(x, y));
        expect(input.crackField.thresholdAt!(x, y)).toBe(field.thresholdAt!(x, y));
        expect(input.bitmap.data[y * 40 + x]).toBe(
          Number(input.crackField.lumaAt(x, y) < input.crackField.thresholdAt!(x, y)),
        );
      }
    expect(image.data).toEqual(before);
  });

  it('rebuilds prepared input after a changed detector or raster while accepting geometry-only changes', () => {
    const image = paper(80);
    for (let y = 10; y < 70; y++) for (let x = 39; x < 42; x++) paint(image, x, y, 247);
    const input = prepareEdgeTraceInput(image, edge);
    const sensitive = { ...edge, edgeLowThresholdRatio: 0.01 };
    expect(edgeTraceInputMatches(input, image, sensitive)).toBe(false);
    expect(edgeTraceInputMatches(input, image, { ...edge, edgeBlurSigma: 0.6 })).toBe(false);
    expect(edgeTraceInputMatches(input, image, { ...edge, edgeMedianFilter: false })).toBe(false);
    expect(edgeTraceInputMatches(input, upscaleBy(image, 2), { ...edge, pixelScale: 2 })).toBe(
      false,
    );
    expect(edgeTraceInputMatches(input, image, { ...edge, smoothness: 0, optimize: 0 })).toBe(true);
    const restored = runTraceSteps(traceImageToEdgePathsSteps(image, sensitive, input));
    expect(restored).toEqual(traceImageToEdgePaths(image, sensitive));
    expect(restored.flatMap((p) => p.polylines)).not.toHaveLength(0);
  });

  it('performs native noise and mask preparation once across profiling and tracing', async () => {
    const image = paper(320);
    for (let y = 60; y < 200; y++) for (let x = 50; x < 230; x++) paint(image, x, y, 0);
    const median = vi.spyOn(preprocess, 'autoMedianFilter');
    const mask = vi.spyOn(localContrast, 'localContrastTraceData');
    const paths = await traceImageToColoredPaths(image, edge);
    expect(paths.flatMap((p) => p.polylines)).toHaveLength(1);
    expect(median).toHaveBeenCalledTimes(1);
    expect(mask).toHaveBeenCalledTimes(1);
  });

  it('repairs source-pixel impulses once before supersampling and measures a fresh working mask', async () => {
    const image = paper(80);
    for (let x = 10; x < 70; x++) paint(image, x, 40, 0);
    for (let y = 5; y < 25; y += 4) for (let x = 5; x < 75; x += 4) paint(image, x, y, 0);
    const cleaned = preprocess.autoMedianFilter(image);
    const expected = await traceImageToColoredPaths(cleaned, { ...edge, edgeMedianFilter: false });
    const median = vi.spyOn(preprocess, 'autoMedianFilter');
    const mask = vi.spyOn(localContrast, 'localContrastTraceData');
    const paths = await traceImageToColoredPaths(image, edge);
    expect(paths).toEqual(expected);
    expect(paths.flatMap((p) => p.polylines)).toHaveLength(1);
    expect(median).toHaveBeenCalledTimes(1);
    expect(mask).toHaveBeenCalledTimes(2);
    expect(mask.mock.calls.map(([source]) => source.width)).toEqual([80, 240]);
  });

  it('keeps explicit forced median on the working raster after enlargement', async () => {
    const image = paper(80);
    for (let x = 10; x < 70; x++) paint(image, x, 40, 0);
    const forced = { ...edge, edgeMedianFilter: true };
    const plan = traceScalePlan(image, forced);
    expect(plan).toEqual({ kind: 'upscale', factor: 3 });
    const expected = downscaleTracedPaths(
      traceImageToEdgePaths(upscaleBy(image, 3), { ...forced, pixelScale: 3 }),
      3,
    );
    expect(expected.flatMap((path) => path.polylines)).not.toHaveLength(0);
    expect(await traceImageToColoredPaths(image, forced)).toEqual(expected);
  });
});

// A disc on a transparent PNG as the loader hands it over: colour composited
// onto white, coverage kept in alpha.
function discOnTransparent(size: number, radius: number, ink: number): RawImageData {
  const image = paper(size);
  const centre = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - centre, y + 0.5 - centre);
      const alpha = Math.max(0, Math.min(1, radius - d + 0.5));
      const offset = (y * size + x) * 4;
      const colour = Math.round(255 - (255 - ink) * alpha);
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = colour;
      image.data[offset + 3] = Math.round(255 * alpha);
    }
  return image;
}

function radialRms(paths: ReadonlyArray<ColoredPath>, centre: number, radius: number): number {
  const points = paths.flatMap((p) => p.polylines).flatMap((pl) => pl.points);
  const sum = points.reduce(
    (s, p) => s + (Math.hypot(p.x - centre, p.y - centre) - radius) ** 2,
    0,
  );
  return Math.sqrt(sum / points.length);
}

describe('Edge Detection alpha mask (ADR-437)', () => {
  it('outlines white art on transparency that the luma detector cannot see', async () => {
    const image = discOnTransparent(400, 120, 255);
    expect(await traceImageToColoredPaths(image, edge)).toEqual([]);
    const alpha = await traceImageToColoredPaths(image, { ...edge, traceTransparency: true });
    expect(alpha.flatMap((p) => p.polylines)).toHaveLength(1);
    expect(radialRms(alpha, 200, 120)).toBeLessThan(0.15);
    // Invert cannot change which pixels are covered, so it stands down.
    expect(
      await traceImageToColoredPaths(image, { ...edge, traceTransparency: true, invert: true }),
    ).toEqual(alpha);
  });

  it('keeps reading coverage on the supersampled grid', async () => {
    // Dark art makes the small-source policy enlarge the trace 3x; the
    // enlarged coverage must not be converted from alpha a second time.
    const image = discOnTransparent(48, 14.4, 0);
    const options = { ...edge, traceTransparency: true };
    expect(traceScalePlan(image, { ...options, sourceHasTransparency: true })).toEqual({
      kind: 'upscale',
      factor: 3,
    });
    const alpha = await traceImageToColoredPaths(image, options);
    expect(alpha.flatMap((p) => p.polylines)).toHaveLength(1);
    // Coverage and composited colour carry the same ramp here, so the alpha
    // outline must be as true as the luma one.
    const luma = await traceImageToColoredPaths(image, edge);
    expect(radialRms(alpha, 24, 14.4)).toBeLessThanOrEqual(radialRms(luma, 24, 14.4) + 0.005);
    expect(radialRms(alpha, 24, 14.4)).toBeLessThan(0.2);
    expect(await traceImageToColoredPaths(image, { ...options, invert: true })).toEqual(alpha);
  });

  it('falls back to luma for an opaque source and rebuilds prepared input when alpha toggles', async () => {
    const image = paper(80);
    for (let y = 20; y < 60; y++) for (let x = 20; x < 60; x++) paint(image, x, y, 0);
    const alphaOptions = { ...edge, traceTransparency: true };
    expect(await traceImageToColoredPaths(image, alphaOptions)).toEqual(
      await traceImageToColoredPaths(image, edge),
    );
    const disc = discOnTransparent(80, 24, 255);
    const input = prepareEdgeTraceInput(disc, edge);
    expect(input.alphaMask).toBe(false);
    expect(edgeTraceInputMatches(input, disc, alphaOptions)).toBe(false);
    expect(prepareEdgeTraceInput(disc, alphaOptions).alphaMask).toBe(true);
  });
});
