import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import * as imageLoader from '../trace/image-loader';
import { createSession } from './editor-session';
import { compositeSession } from './editor-session-layers';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bakeBufferToBitmapFields', () => {
  it('encodes PNG and luma from the same frozen revision while later edits mutate the document', async () => {
    const doc = createRgbaBuffer(2, 1);
    doc.data.set([0, 0, 0, 255], 4);
    let pngPixels: ImageData | undefined;
    let finish: BlobCallback | undefined;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () =>
        ({
          putImageData: (pixels: ImageData) => {
            pngPixels = pixels;
          },
        }) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      finish = callback;
    });
    const pending = bakeBufferToBitmapFields(doc);
    expect(pngPixels?.width).toBe(2);
    expect(pngPixels?.height).toBe(1);
    if (pngPixels === undefined) throw new Error('PNG pixels were not captured');
    expect([...pngPixels.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    doc.data.fill(0);
    if (finish === undefined) throw new Error('PNG encoding did not start');
    finish(new Blob(['encoded-snapshot'], { type: 'image/png' }));
    const fields = await pending;
    expect(fields.lumaBase64).toBe(btoa(String.fromCharCode(255, 0)));
    expect(fields.lumaBase64).toBe(imageLoader.extractLumaBase64(pngPixels));
    expect(fields.dataUrl).toBe('data:image/png;base64,ZW5jb2RlZC1zbmFwc2hvdA==');
  });
});

const IMAGE: RasterImage = {
  kind: 'raster-image',
  id: 'image-1',
  source: 'source.png',
  dataUrl: 'data:image/png;base64,aGVsbG8=',
  pixelWidth: 2,
  pixelHeight: 1,
  bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
  transform: IDENTITY_TRANSFORM,
  color: '#808080',
  dither: 'threshold',
  linesPerMm: 1,
};

describe('decodeRasterToBuffer', () => {
  it('decodes stored data URLs without fetch so production CSP cannot block Image Studio', async () => {
    const doc = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]),
    };
    const loadImageAsRawData = vi.spyOn(imageLoader, 'loadImageAsRawData').mockResolvedValue(doc);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('Refused to connect because it violates connect-src'));

    await expect(decodeRasterToBuffer(IMAGE)).resolves.toBe(doc);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(loadImageAsRawData).toHaveBeenCalledTimes(1);
    const [file, maxEdge] = loadImageAsRawData.mock.calls[0] ?? [];
    expect(file).toBeInstanceOf(File);
    expect(file).toMatchObject({ name: 'image-studio-source', type: 'image/png' });
    expect(maxEdge).toBe(2);
  });

  it('keeps the saved grid of a turned JPEG imported before ADR-404', async () => {
    // Saved 2x1 with the photo squashed into it; the loader now decodes it turned.
    vi.spyOn(imageLoader, 'loadImageAsRawData').mockResolvedValue({
      width: 1,
      height: 2,
      data: new Uint8ClampedArray([90, 90, 90, 255, 90, 90, 90, 255]),
    });

    await expect(decodeRasterToBuffer(IMAGE)).resolves.toMatchObject({ width: 2, height: 1 });
  });

  it('hands the editor straight colour so Apply keeps the imported tone of partly transparent pixels', async () => {
    // Straight RGBA as a browser decodes it: black at 50% and 30% coverage, a
    // colour at 78%, a nearly and a fully transparent pixel, one opaque grey.
    const straight = new Uint8ClampedArray([
      0, 0, 0, 128, 0, 0, 0, 77, 90, 140, 200, 200, 0, 0, 0, 1, 12, 34, 56, 0, 30, 30, 30, 255,
    ]);
    // The loader hands back RGB composited on white with alpha kept: the tone import burns.
    const imported = imageLoader.compositeRgbOverWhitePreservingAlpha({
      width: 6,
      height: 1,
      data: straight,
    });
    const importedLuma = lumaBytes(imported);
    vi.spyOn(imageLoader, 'loadImageAsRawData').mockResolvedValue(imported);

    const doc = await decodeRasterToBuffer({ ...IMAGE, pixelWidth: 6, pixelHeight: 1 });
    const baked = compositeSession(createSession('image-1', 'source.png', doc, IMAGE.bounds));

    expect(alphaBytes(doc)).toEqual([128, 77, 200, 1, 0, 255]);
    expect(importedLuma[0]).toBe(127);
    const bakedLuma = lumaBytes(baked);
    bakedLuma.forEach((luma, index) => {
      expect(Math.abs(luma - (importedLuma[index] ?? -1))).toBeLessThanOrEqual(1);
    });
  });

  it('keeps an opaque decode byte for byte', async () => {
    const opaque = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([9, 99, 199, 255, 0, 0, 0, 255]),
    };
    vi.spyOn(imageLoader, 'loadImageAsRawData').mockResolvedValue({
      ...opaque,
      rgbCompositedOnWhite: true,
    });

    const doc = await decodeRasterToBuffer(IMAGE);

    expect([...doc.data]).toEqual([9, 99, 199, 255, 0, 0, 0, 255]);
  });
});

function lumaBytes(image: { width: number; height: number; data: Uint8ClampedArray }): number[] {
  return [...atob(imageLoader.extractLumaBase64(image))].map((char) => char.charCodeAt(0));
}

function alphaBytes(image: { data: Uint8ClampedArray }): number[] {
  return [...image.data].filter((_, index) => index % 4 === 3);
}
