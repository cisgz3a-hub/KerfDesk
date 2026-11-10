// A PNG decoded at its own size goes through createImageBitmap, off the UI
// thread, instead of an <img> whose decode ran inside the canvas snapshot on
// the UI thread (about 0.5 s at 9 MP). Chromium gives identical pixels both
// ways for PNG, so only the thread changes. A JPEG keeps the element: its
// canvas YUV conversion differs from a bitmap decode by 1 in some bytes.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  exifChunk,
  syntheticPngBytes,
  type SyntheticPngOptions,
} from '../../io/raster-decode/exif-orientation.test-support';
import { loadImageAsRawData } from './image-loader';
import {
  bitmapDecoder,
  elementDecoder,
  recordCanvas,
} from './image-loader-orientation.test-support';
import { syntheticJpegFile } from './jpeg-header.test-support';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pngFile(options: SyntheticPngOptions): File {
  return new File([syntheticPngBytes(options)], 'page.png', { type: 'image/png' });
}

describe('an image at its own decode size', () => {
  it('decodes a PNG through createImageBitmap, turned by the image, without an <img>', async () => {
    const { draws } = recordCanvas();
    const { decode, close } = bitmapDecoder(() => [800, 600]);
    const { createObjectURL } = elementDecoder({ width: 800, height: 600 });
    const file = pngFile({ width: 800, height: 600 });

    const image = await loadImageAsRawData(file);

    expect(decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image' });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(draws).toEqual([{ transform: null, size: [800, 600] }]);
    expect(close).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ width: 800, height: 600 });
  });

  it('keeps a JPEG on the <img> route', async () => {
    recordCanvas();
    const { decode } = bitmapDecoder(() => [800, 600]);
    const { createObjectURL } = elementDecoder({ width: 800, height: 600 });

    const image = await loadImageAsRawData(syntheticJpegFile({ width: 800, height: 600 }));

    expect(decode).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ width: 800, height: 600 });
  });

  it('turns a PNG on the <img> route when the bitmap decode ignored its eXIf', async () => {
    const { draws } = recordCanvas();
    // The stored, unturned frame comes back for an Orientation 6 PNG.
    const { close } = bitmapDecoder(() => [800, 600]);
    const { createObjectURL } = elementDecoder({ width: 800, height: 600 });

    const image = await loadImageAsRawData(
      pngFile({ width: 800, height: 600, beforeIdat: [exifChunk(6)] }),
    );

    expect(close).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ width: 600, height: 800 });
    expect(draws).toEqual([{ transform: [0, 1, -1, 0, 600, 0], size: [800, 600] }]);
  });
});
