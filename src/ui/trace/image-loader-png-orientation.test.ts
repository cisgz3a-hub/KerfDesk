// PNG eXIf Orientation in the image loader (ADR-404 Amendment 1, rolling audit
// v5 J6-P1-1). Chromium turns a PNG by its eXIf Orientation as it turns a
// JPEG: a 40x20 PNG with Orientation 6 decodes 20x40. The loader read the PNG
// as never turned, so the import sized it from IHDR (4 x 2 mm at 254 DPI)
// around the turned 20x40 pixels, stretching each pixel 4:1.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exifChunk,
  exifTiffBlock,
  physChunk,
  pngChunk,
  syntheticPngBytes,
  type SyntheticPngOptions,
} from '../../io/raster-decode/exif-orientation.test-support';
import { densityFromBytes } from '../common/image-density';
import { rasterImportGeometry } from '../common/image-import';
import { loadImageSamples } from '../import/prepare-image-samples';
import { loadImageAsRawData, readImageNaturalSize } from './image-loader';
import {
  bitmapDecoder,
  elementDecoder,
  recordCanvas,
} from './image-loader-orientation.test-support';
import { syntheticJpegFile } from './jpeg-header.test-support';
import type { ExifOrientation } from './jpeg-header';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ALL: ReadonlyArray<ExifOrientation> = [1, 2, 3, 4, 5, 6, 7, 8];

function pngFile(options: SyntheticPngOptions): File {
  return new File([syntheticPngBytes(options)], 'turned.png', { type: 'image/png' });
}

describe('the loader turns a PNG by its eXIf Orientation, as it turns a JPEG', () => {
  it.each(ALL)('Orientation %i: PNG and JPEG report the same turned size', async (orientation) => {
    const { createObjectURL } = elementDecoder({ width: 1, height: 1 });
    const turned = orientation >= 5 ? { width: 20, height: 40 } : { width: 40, height: 20 };
    const png = pngFile({ width: 40, height: 20, beforeIdat: [exifChunk(orientation)] });
    const jpeg = syntheticJpegFile({ width: 40, height: 20, orientation });

    await expect(readImageNaturalSize(png)).resolves.toEqual(turned);
    await expect(readImageNaturalSize(jpeg)).resolves.toEqual(turned);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it.each(ALL)(
    'Orientation %i: the trace loader asks for the turned size of a PNG and a JPEG',
    async (orientation) => {
      recordCanvas();
      const { decode } = bitmapDecoder((w, h) => [w, h]);
      const [width, height] = orientation >= 5 ? [1536, 2048] : [2048, 1536];
      const files = [
        pngFile({ width: 4000, height: 3000, beforeIdat: [exifChunk(orientation)] }),
        syntheticJpegFile({ width: 4000, height: 3000, orientation }),
      ];

      for (const file of files) {
        const image = await loadImageAsRawData(file);
        expect(decode).toHaveBeenLastCalledWith(file, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: 'high',
          imageOrientation: 'from-image',
        });
        expect(image).toMatchObject({ width, height });
      }
    },
  );

  it("lands the audit's 40x20 PNG with Orientation 6 portrait: bounds and grid agree", async () => {
    recordCanvas();
    vi.stubGlobal('createImageBitmap', undefined);
    // Chromium reports and draws the element turned.
    elementDecoder({ width: 20, height: 40 });

    const loaded = await loadImageSamples(
      pngFile({ width: 40, height: 20, beforeIdat: [exifChunk(6)] }),
      false,
      false,
    );
    const geometry = rasterImportGeometry({
      naturalWidth: loaded.natural.width,
      naturalHeight: loaded.natural.height,
      sampledWidth: loaded.sampled.width,
      sampledHeight: loaded.sampled.height,
    });

    expect(loaded.natural).toEqual({ width: 20, height: 40 });
    expect(loaded.sampled).toMatchObject({ width: 20, height: 40 });
    // Default 254 DPI: 0.1 mm per pixel, portrait.
    expect(geometry.bounds.maxX).toBeCloseTo(2, 6);
    expect(geometry.bounds.maxY).toBeCloseTo(4, 6);
    expect([geometry.pixelWidth, geometry.pixelHeight]).toEqual([20, 40]);
  });

  it('turns the PNG on the canvas when the engine ignored its eXIf', async () => {
    const { draws } = recordCanvas();
    vi.stubGlobal('createImageBitmap', undefined);
    elementDecoder({ width: 40, height: 20 });

    const image = await loadImageAsRawData(
      pngFile({ width: 40, height: 20, beforeIdat: [exifChunk(6)] }),
    );

    expect(image).toMatchObject({ width: 20, height: 40 });
    expect(draws).toEqual([{ transform: [0, 1, -1, 0, 20, 0], size: [40, 20] }]);
  });

  it('reads an eXIf beyond the 64 KiB header probe, and none after IDAT', async () => {
    elementDecoder({ width: 1, height: 1 });
    const text = pngChunk({ type: 'tEXt', data: new Array<number>(100_000).fill(65) });

    await expect(
      readImageNaturalSize(pngFile({ width: 40, height: 20, beforeIdat: [text, exifChunk(6)] })),
    ).resolves.toEqual({ width: 20, height: 40 });
    await expect(
      readImageNaturalSize(pngFile({ width: 40, height: 20, afterIdat: [exifChunk(6)] })),
    ).resolves.toEqual({ width: 40, height: 20 });
  });

  it('swaps an anisotropic pHYs density with the axes it describes', () => {
    // 11811 and 5906 pixels per metre: 300 and 150 DPI.
    const phys = physChunk(11811, 5906);
    const bytes = (before: number[][]) =>
      syntheticPngBytes({ width: 40, height: 20, beforeIdat: before });
    expect(densityFromBytes(bytes([phys]))).toEqual({ xDpi: 300, yDpi: 150 });
    expect(densityFromBytes(bytes([phys, exifChunk(6)]))).toEqual({ xDpi: 150, yDpi: 300 });
    expect(densityFromBytes(bytes([phys, exifChunk(3)]))).toEqual({ xDpi: 300, yDpi: 150 });
  });

  it('reads a JPEG Orientation recorded only in the Exif sub-IFD, as Chromium does', async () => {
    elementDecoder({ width: 1, height: 1 });
    const exifTiff = exifTiffBlock({ byteOrder: 'II', subIfd: [{ value: 6 }] });

    await expect(
      readImageNaturalSize(syntheticJpegFile({ width: 40, height: 20, exifTiff })),
    ).resolves.toEqual({ width: 20, height: 40 });
  });
});
