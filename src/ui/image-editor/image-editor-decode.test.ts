import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import { createRgbaBuffer } from '../../core/image-edit/rgba-buffer';
import * as imageLoader from '../trace/image-loader';
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
});
