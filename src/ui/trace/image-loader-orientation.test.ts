// EXIF Orientation in the image loader. A phone stores a portrait photo as a
// 4032x3024 frame with Orientation 6; the browser decodes it turned, 3024x4032.
// Every size derived from the header (the decode cap, the requested bitmap,
// the returned raster and the import's natural size) must be the turned one.
// Before this, the decoder was asked for 2048x1536 and the raster squashed.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { rasterImportGeometry } from '../common/image-import';
import { densityFromBytes } from '../common/image-density';
import { loadImageSamples } from '../import/prepare-image-samples';
import { fitDecodeToStoredGrid, loadImageAsRawData, readImageNaturalSize } from './image-loader';
import { syntheticJpegBytes, syntheticJpegFile } from './jpeg-header.test-support';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const PHONE = { width: 4032, height: 3024 };

type DrawCall = { readonly transform: ReadonlyArray<number> | null; readonly size: number[] };

function recordCanvas(): { readonly draws: DrawCall[] } {
  const draws: DrawCall[] = [];
  let transform: ReadonlyArray<number> | null = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const { width, height } = this;
    return {
      setTransform: (...matrix: number[]) => {
        transform = matrix.join() === '1,0,0,1,0,0' ? null : matrix;
      },
      drawImage: (_source: unknown, _x: number, _y: number, w: number, h: number) => {
        draws.push({ transform, size: [w, h] });
      },
      getImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    } as unknown as CanvasRenderingContext2D;
  } as unknown as HTMLCanvasElement['getContext']);
  return { draws };
}

function bitmapDecoder(respond: (width: number, height: number) => [number, number]) {
  const close = vi.fn();
  const decode = vi.fn(async (_file: Blob, options: ImageBitmapOptions) => {
    const [width, height] = respond(options.resizeWidth ?? 0, options.resizeHeight ?? 0);
    return { width, height, close } as unknown as ImageBitmap;
  });
  vi.stubGlobal('createImageBitmap', decode);
  return { decode, close };
}

// The HTMLImageElement route; `natural` is what the engine reports.
function elementDecoder(natural: { readonly width: number; readonly height: number }) {
  const createObjectURL = vi.fn(() => 'blob:photo');
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public width = natural.width;
    public height = natural.height;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return { createObjectURL };
}

describe('loadImageAsRawData honours EXIF Orientation', () => {
  it.each([
    [1, 2048, 1536],
    [3, 2048, 1536],
    [6, 1536, 2048],
    [8, 1536, 2048],
  ] as const)(
    'Orientation %i asks the decoder for the turned %ix%i with the image orientation',
    async (orientation, width, height) => {
      recordCanvas();
      const { decode } = bitmapDecoder((w, h) => [w, h]);
      const file = syntheticJpegFile({ ...PHONE, orientation });

      const image = await loadImageAsRawData(file);

      expect(decode).toHaveBeenCalledWith(file, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
        imageOrientation: 'from-image',
      });
      expect(image).toMatchObject({ width, height });
    },
  );

  it('keeps a full-size bitmap from an engine that ignored only the resize options', async () => {
    const { draws } = recordCanvas();
    // The engine turned the photo but returned its whole decoded frame.
    const { close } = bitmapDecoder(() => [3024, 4032]);
    const { createObjectURL } = elementDecoder({ width: 3024, height: 4032 });

    const image = await loadImageAsRawData(syntheticJpegFile({ ...PHONE, orientation: 6 }));

    expect(createObjectURL).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ width: 1536, height: 2048 });
    expect(draws).toEqual([{ transform: null, size: [1536, 2048] }]);
  });

  it('turns the photo on the element route when the bitmap ignored resize and Orientation', async () => {
    const { draws } = recordCanvas();
    // The whole stored landscape frame: stretching it onto 1536x2048 would squash it.
    const { close } = bitmapDecoder(() => [PHONE.width, PHONE.height]);
    const { createObjectURL } = elementDecoder(PHONE);

    const image = await loadImageAsRawData(syntheticJpegFile({ ...PHONE, orientation: 6 }));

    expect(close).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ width: 1536, height: 2048 });
    expect(draws).toEqual([{ transform: [0, 1, -1, 0, 1536, 0], size: [2048, 1536] }]);
  });

  it('draws the element as decoded when the engine already turned it', async () => {
    const { draws } = recordCanvas();
    vi.stubGlobal('createImageBitmap', undefined);
    elementDecoder({ width: 3024, height: 4032 });

    const image = await loadImageAsRawData(syntheticJpegFile({ ...PHONE, orientation: 6 }));

    expect(image).toMatchObject({ width: 1536, height: 2048 });
    expect(draws).toEqual([{ transform: null, size: [1536, 2048] }]);
  });

  it.each([
    [6, [0, 1, -1, 0, 1536, 0]],
    [8, [0, -1, 1, 0, 0, 2048]],
  ] as const)(
    'turns Orientation %i on the canvas when the engine ignored it',
    async (orientation, matrix) => {
      const { draws } = recordCanvas();
      vi.stubGlobal('createImageBitmap', undefined);
      elementDecoder(PHONE);

      const image = await loadImageAsRawData(syntheticJpegFile({ ...PHONE, orientation }));

      expect(image).toMatchObject({ width: 1536, height: 2048 });
      // The stored landscape frame is drawn 2048x1536 and turned upright.
      expect(draws).toEqual([{ transform: matrix, size: [2048, 1536] }]);
    },
  );
});

describe('import sizes use the oriented image', () => {
  it('reports the turned natural size without decoding', async () => {
    const { createObjectURL } = elementDecoder({ width: 1, height: 1 });

    await expect(
      readImageNaturalSize(syntheticJpegFile({ ...PHONE, orientation: 6 })),
    ).resolves.toEqual({ width: 3024, height: 4032 });
    await expect(
      readImageNaturalSize(syntheticJpegFile({ ...PHONE, orientation: 3 })),
    ).resolves.toEqual(PHONE);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('lands a turned photo portrait at its real size', async () => {
    recordCanvas();
    vi.stubGlobal('createImageBitmap', undefined);
    // A small frame keeps the decoded buffers light; the aspect is the phone's.
    elementDecoder({ width: 300, height: 400 });
    const file = syntheticJpegFile({ width: 400, height: 300, orientation: 6 });

    const loaded = await loadImageSamples(file, false, false);
    const geometry = rasterImportGeometry({
      naturalWidth: loaded.natural.width,
      naturalHeight: loaded.natural.height,
      sampledWidth: loaded.sampled.width,
      sampledHeight: loaded.sampled.height,
    });

    expect(loaded.natural).toEqual({ width: 300, height: 400 });
    expect(loaded.sampled).toMatchObject({ width: 300, height: 400 });
    // Default 254 DPI: 0.1 mm per pixel, portrait.
    expect(geometry.bounds.maxX).toBeCloseTo(30, 6);
    expect(geometry.bounds.maxY).toBeCloseTo(40, 6);
  });

  it('swaps an anisotropic JFIF density with the axes it describes', () => {
    const jfifDpi = { x: 300, y: 150 };
    expect(densityFromBytes(syntheticJpegBytes({ ...PHONE, jfifDpi }))).toEqual({
      xDpi: 300,
      yDpi: 150,
    });
    expect(densityFromBytes(syntheticJpegBytes({ ...PHONE, jfifDpi, orientation: 6 }))).toEqual({
      xDpi: 150,
      yDpi: 300,
    });
  });
});

describe('fitDecodeToStoredGrid (projects saved before ADR-396)', () => {
  const decoded = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4).fill(200),
    rgbCompositedOnWhite: true,
  });

  it('resamples a turned decode back onto the saved landscape grid', () => {
    const fitted = fitDecodeToStoredGrid(decoded(3, 4), 4, 3);

    expect(fitted).toMatchObject({ width: 4, height: 3, rgbCompositedOnWhite: true });
    expect(fitted.data.length).toBe(4 * 3 * 4);
  });

  it.each([
    ['a decode on the saved grid', 4, 3, 4, 3],
    ['a square grid', 3, 3, 3, 3],
    ['a mismatch that is not a transpose', 2, 5, 4, 3],
  ])('returns %s unchanged', (_name, w, h, savedW, savedH) => {
    const pixels = decoded(w, h);
    expect(fitDecodeToStoredGrid(pixels, savedW, savedH)).toBe(pixels);
  });
});
