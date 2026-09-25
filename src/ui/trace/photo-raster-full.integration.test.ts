import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { decodePngFile } from '../../__fixtures__/perceptual/png-decode';
import { boundsFromColoredPaths, TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import {
  assembleBitmap,
  type BitmapConversionOptions,
  type ConvertibleVector,
} from '../raster/bitmap-assembly';
import { lumaToBase64 } from '../raster/luma-bitmap';
import { buildRasterTraceOutput } from './trace-raster-output';

vi.mock('../raster/convert-bitmap-worker-client', () => ({
  convertBitmapInWorker: (
    vectors: readonly ConvertibleVector[],
    options: BitmapConversionOptions,
    id: string,
  ) => {
    // The worker receives only packed numeric contours and source metadata,
    // never another copy of both object-heavy geometry representations.
    expect(vectors).toHaveLength(1);
    expect(vectors[0]?.paths).toEqual([]);
    expect(options.photoRibbons?.points.length).toBeGreaterThan(300_000);
    return Promise.resolve(
      assembleBitmap(
        vectors,
        (raster) => ({ dataUrl: 'data:image/png;base64,', lumaBase64: lumaToBase64(raster.luma) }),
        id,
        options,
      ),
    );
  },
}));

// sRGB decoding written out from CSS Color 4, independent of the tracer.
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const image = decodePngFile(resolve('src/__fixtures__/perceptual/assets/astronaut.png'));
const source: RasterImage = {
  kind: 'raster-image',
  id: 'photo',
  source: 'astronaut.png',
  dataUrl: 'data:image/png;base64,',
  pixelWidth: image.width,
  pixelHeight: image.height,
  bounds: { minX: 0, minY: 0, maxX: 64, maxY: 64 },
  transform: IDENTITY_TRANSFORM,
  color: '#000000',
  dither: 'floyd-steinberg',
  linesPerMm: 10,
};

describe('uncropped photo raster output', () => {
  it.each([60, 100])(
    'commits the complete detailed portrait at Detail %s without dropping geometry',
    async (photoDetail) => {
      const paths = await traceImageToColoredPaths(image, {
        ...TRACE_PRESETS['Photo shading']!,
        photoDetail,
      });
      const traced: TracedImage = {
        kind: 'traced-image',
        id: 'photo-trace',
        source: source.source,
        traceMode: 'filled-contours',
        tracePixelWidth: image.width,
        tracePixelHeight: image.height,
        bounds: boundsFromColoredPaths(paths),
        paths,
        transform: IDENTITY_TRANSFORM,
      };
      const inputPoints = paths
        .flatMap((path) => path.polylines)
        .reduce((sum, line) => sum + line.points.length, 0);
      expect(inputPoints).toBeGreaterThan(150_000);
      const raster = await buildRasterTraceOutput(
        source,
        traced,
        [createLayer({ id: 'image', color: '#000000', mode: 'image' })],
        true,
      );
      expect(raster.pixelWidth).toBe(640);
      expect(raster.pixelHeight).toBe(640);
      const luma = Uint8Array.from(atob(raster.lumaBase64 ?? ''), (c) => c.charCodeAt(0));
      expect(luma.length).toBe(640 * 640);
      // Independent source RGBA integral. Photo vectors leave uncovered the
      // source's linear-light luminance (ADR-390), and the bitmap stores that
      // uncovered share; bounds differ only at the outer ribbon edges.
      let sourceLuma = 0;
      for (let offset = 0; offset < image.data.length; offset += 4) {
        sourceLuma +=
          255 *
          (0.2126 * linear(image.data[offset]!) +
            0.7152 * linear(image.data[offset + 1]!) +
            0.0722 * linear(image.data[offset + 2]!));
      }
      const actualMean = luma.reduce((sum, value) => sum + value, 0) / luma.length;
      expect(Math.abs(actualMean - sourceLuma / (image.width * image.height))).toBeLessThan(0.8);
      expect(
        paths.flatMap((path) => path.polylines).reduce((sum, line) => sum + line.points.length, 0),
      ).toBe(inputPoints);
      expect(raster.id).toBe(traced.id);
    },
    30000,
  );
});
