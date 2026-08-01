import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import * as imageLoader from '../trace/image-loader';
import { decodeRasterToBuffer } from './image-editor-decode';

afterEach(() => {
  vi.restoreAllMocks();
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
