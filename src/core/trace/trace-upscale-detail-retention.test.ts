import { describe, expect, it } from 'vitest';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';
import { traceScalePlan } from './trace-upscale-policy';

function grayHairline(luma: number, transpose: boolean, attached = false): RawImageData {
  const width = transpose ? 128 : 320;
  const height = transpose ? 320 : 128;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const pixel = (x: number, y: number, value: number): void => {
    const index = transpose ? x * width + y : y * width + x;
    data.set([value, value, value, 255], index * 4);
  };
  // Broad black ink keeps the Otsu background/ink populations stable. The
  // separate gray line is long enough to pass both preset cleanup floors.
  for (let y = 15; y < 45; y += 1) {
    for (let x = 20; x < 240; x += 1) pixel(x, y, 0);
  }
  for (let x = 40; x < 200; x += 1) pixel(x, 85, luma);
  if (attached) {
    for (let y = 45; y < 85; y += 1) pixel(40, y, 0);
  }
  return { width, height, data };
}

function hairlineIndices(image: RawImageData, transpose: boolean): number[] {
  return Array.from({ length: 160 }, (_, offset) => {
    const x = 40 + offset;
    return transpose ? x * image.width + 85 : 85 * image.width + x;
  });
}

describe('automatic contour enlargement retains detected source detail', () => {
  for (const preset of ['Line Art', 'Smooth']) {
    it.each([90, 100, 127])(
      `${preset} retains a one-pixel line at luma %s`,
      async (luma) => {
        for (const transpose of [false, true]) {
          const image = grayHairline(luma, transpose);
          const options = TRACE_PRESETS[preset] as TraceOptions;
          const source = image.data.slice();
          const indices = hairlineIndices(image, transpose);
          const prepared = preprocessForTrace(image, options);
          // This detail already survives detection and despeckling. The optional
          // quality enlargement must not erase it by mixing its luma with white.
          expect(indices.every((index) => prepared.data[index * 4] === 0)).toBe(true);
          expect(traceScalePlan(image, options)).toEqual({ kind: 'upscale', factor: 2 });
          const paths = await traceImageToColoredPaths(image, options);
          const rendered = rasterizeColoredPaths(paths, image.width, image.height);
          const retained = indices.filter((index) => rendered.data[index] === 1).length;
          expect(retained / indices.length).toBeGreaterThan(0.98);
          expect(image.data.every((value, index) => value === source[index])).toBe(true);
        }
      },
      30_000,
    );

    it(`${preset} retains a thin gray branch connected to broad surviving ink`, async () => {
      const image = grayHairline(100, false, true);
      const paths = await traceImageToColoredPaths(image, TRACE_PRESETS[preset]!);
      const rendered = rasterizeColoredPaths(paths, image.width, image.height);
      const indices = hairlineIndices(image, false);
      expect(
        indices.filter((index) => rendered.data[index] === 1).length / indices.length,
      ).toBeGreaterThan(0.98);
      expect(paths.flatMap((path) => path.polylines)).toHaveLength(1);
    }, 30_000);

    it(`${preset} retains an admitted small white counter`, async () => {
      const image = grayHairline(100, false);
      const counter = (30 * image.width + 80) * 4;
      image.data.set([160, 160, 160, 255], counter);
      const options = {
        ...TRACE_PRESETS[preset]!,
        fillPinholeCracks: false,
        ignoreLessThanPixels: 0,
      };
      const native = preprocessForTrace(image, options);
      expect(native.data[counter]).toBe(255);
      const paths = await traceImageToColoredPaths(image, options);
      const rendered = rasterizeColoredPaths(paths, image.width, image.height);
      expect(rendered.data[counter / 4]).toBe(0);
      expect(rendered.data[counter / 4 - 1]).toBe(1);
      expect(rendered.data[counter / 4 + 1]).toBe(1);
      expect(paths.flatMap((path) => path.polylines)).toHaveLength(3);
    }, 30_000);
  }
});
