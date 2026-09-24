import { describe, expect, it } from 'vitest';
import { prepareTraceForContour, type RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { rasterizeColoredPaths } from '../../__fixtures__/perceptual/rasterize';
import { traceImageToColoredPaths } from './trace-to-paths';

const options = {
  ...TRACE_PRESETS['Line Art']!,
  faintLineRecovery: true,
  despeckleMinPixels: 0,
  fillPinholeCracks: false,
};

function mixedStroke(run: number, scale = 1): RawImageData {
  const width = 192 * scale;
  const height = 80 * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 40 * scale; y < 41 * scale; y += 1)
    for (let x = 16 * scale; x < 176 * scale; x += 1) {
      const luma = Math.floor((Math.floor(x / scale) - 16) / run) % 2 === 0 ? 0 : 200;
      data.set([luma, luma, luma, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

function lineInk(image: RawImageData, scale = 1): number {
  let count = 0;
  for (let y = 40 * scale; y < 41 * scale; y += 1)
    for (let x = 16 * scale; x < 176 * scale; x += 1)
      if (image.data[(y * image.width + x) * 4]! < 128) count += 1;
  return count;
}

function paintFillWithHalo(image: RawImageData): void {
  for (let y = 5; y < 30; y += 1)
    for (let x = 5; x < 75; x += 1) {
      const edge = x === 5 || x === 74 || y === 5 || y === 29;
      const luma = edge ? 200 : 0;
      image.data.set([luma, luma, luma, 255], (y * image.width + x) * 4);
    }
}

function haloInk(image: RawImageData): number {
  let halo = 0;
  for (let y = 5; y < 30; y += 1)
    for (let x = 5; x < 75; x += 1)
      if (x === 5 || x === 74 || y === 5 || y === 29)
        halo += image.data[(y * image.width + x) * 4]! < 128 ? 1 : 0;
  return halo;
}

describe('coherent faint connectors', () => {
  it.each([4, 6, 8, 10, 12, 16])(
    'retains a complete thin stroke with alternating %spx dark and faint runs',
    (run) => {
      for (const pixelScale of [1, 2]) {
        const image = mixedStroke(run, pixelScale);
        const { prepared } = prepareTraceForContour(image, { ...options, pixelScale });
        expect(lineInk(prepared, pixelScale)).toBe(160 * pixelScale ** 2);
      }
    },
  );

  it('does not admit separate pale specks or a halo around a broad dark fill', () => {
    const image = mixedStroke(8);
    const marks = [20, 44, 68, 92, 116, 140, 164];
    for (const x of marks) image.data.set([200, 200, 200, 255], (42 * image.width + x) * 4);
    paintFillWithHalo(image);
    const { prepared } = prepareTraceForContour(image, options);
    expect(lineInk(prepared)).toBe(160);
    for (const x of marks) expect(prepared.data[(42 * image.width + x) * 4]).toBe(255);
    expect(haloInk(prepared)).toBe(0);
  });

  it('keeps dark and faint runs connected in generated vectors', async () => {
    const image = mixedStroke(8);
    const paths = await traceImageToColoredPaths(image, {
      ...options,
      autoUpscaleSmallSources: false,
      upscaleSmallSmoothSources: false,
      supersampleContour: false,
    });
    expect(paths.reduce((total, path) => total + path.polylines.length, 0)).toBe(1);
    const raster = rasterizeColoredPaths(paths, image.width, image.height);
    let covered = 0;
    for (let x = 16; x < 176; x += 1) covered += raster.data[40 * image.width + x] ?? 0;
    expect(covered).toBeGreaterThanOrEqual(158);
  });
});
