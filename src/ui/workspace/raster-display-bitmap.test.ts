// Regression tests for ADR-359 Amendment 1: the design canvas draws a picture
// from a copy createImageBitmap decodes once, off the main thread, instead of
// the lazily decoded <img> that Chromium re-decoded (160-670 ms for a 24 MP
// JPEG) each time a zoom needed more of its pixels.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_DECODED_DISPLAY_EDGE,
  decodedDisplaySize,
  decodedRasterDisplay,
  pruneDecodedRasterDisplays,
  resetDecodedRasterDisplaysForTests,
} from './raster-display-bitmap';

type Size = { readonly width: number; readonly height: number };
type FakeBitmap = Size & { readonly close: () => void };
type DecodeCall = { readonly blob: Blob; readonly options: ImageBitmapOptions | undefined };
type Decoder = { readonly calls: DecodeCall[]; readonly bitmaps: FakeBitmap[] };

const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a];
const JPEG_URL = `data:image/jpeg;base64,${btoa(String.fromCharCode(...JPEG_BYTES))}`;

afterEach(() => {
  resetDecodedRasterDisplaysForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('decodedRasterDisplay', () => {
  it('decodes the source bytes once, off the <img>, and redraws when the copy lands', async () => {
    const decoder = stubDecoder({ width: 4000, height: 3000 });
    const onReady = vi.fn();

    expect(decodedRasterDisplay(JPEG_URL, image(4000, 3000), onReady)).toBeNull();
    // Deferred to a later task so the asking frame paints the <img> at once.
    expect(decoder.calls).toHaveLength(0);
    await settle();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(decoder.calls).toHaveLength(1);
    const call = decoder.calls[0];
    expect(call?.options).toEqual({ imageOrientation: 'from-image' });
    expect(call?.blob.type).toBe('image/jpeg');
    expect([...new Uint8Array(await blobBytes(call?.blob))]).toEqual(JPEG_BYTES);
    const bitmap = decoder.bitmaps[0];
    expect(decodedRasterDisplay(JPEG_URL, image(4000, 3000), onReady)).toBe(bitmap);
    expect(decodedRasterDisplay(JPEG_URL, image(4000, 3000))).toBe(bitmap);
    expect(decoder.calls).toHaveLength(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('caps the copy at a 4096 px edge, turned like the <img>', async () => {
    const decoder = stubDecoder({ width: 6000, height: 4000 });

    decodedRasterDisplay(JPEG_URL, image(6000, 4000));
    await settle();

    expect(decodedDisplaySize({ width: 6000, height: 4000 })).toEqual({
      width: MAX_DECODED_DISPLAY_EDGE,
      height: 2731,
    });
    expect(decoder.calls[0]?.options).toEqual({
      imageOrientation: 'from-image',
      resizeWidth: MAX_DECODED_DISPLAY_EDGE,
      resizeHeight: 2731,
      resizeQuality: 'low',
    });
    expect(decodedRasterDisplay(JPEG_URL, image(6000, 4000))).toBe(decoder.bitmaps[0]);
  });

  it('keeps drawing the <img> when the engine returns another size, without retrying', async () => {
    // An engine that ignored the EXIF turn hands back the stored frame.
    const decoder = stubDecoder({ width: 3000, height: 4000 });
    const onReady = vi.fn();

    decodedRasterDisplay(JPEG_URL, image(4000, 3000), onReady);
    await settle();

    expect(decoder.bitmaps[0]?.close).toHaveBeenCalledTimes(1);
    expect(decodedRasterDisplay(JPEG_URL, image(4000, 3000), onReady)).toBeNull();
    await settle();
    expect(decoder.calls).toHaveLength(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('draws the <img> where no copy can be made', async () => {
    // No createImageBitmap at all (jsdom, old engines).
    expect(decodedRasterDisplay(JPEG_URL, image(40, 30))).toBeNull();

    const undecodable = 'data:image/png;base64,AAAA';
    const decoder = stubDecoder({ width: 40, height: 30 }, undecodable);
    const svgUrl = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http://www.w3.org/2000/svg%22/%3E';
    decodedRasterDisplay(svgUrl, image(40, 30));
    decodedRasterDisplay(undecodable, image(40, 30));
    await settle();

    expect(decodedRasterDisplay(svgUrl, image(40, 30))).toBeNull();
    expect(decodedRasterDisplay(undecodable, image(40, 30))).toBeNull();
    await settle();
    // The utf-8 SVG never reaches the decoder; neither failure is retried.
    expect(decoder.calls.map((call) => call.blob.type)).toEqual(['image/png']);
  });

  it('drops the copy of a source no object draws as it is, even one still decoding', async () => {
    const decoder = stubDecoder({ width: 64, height: 64 });
    decodedRasterDisplay('data:image/png;base64,AQID', image(64, 64));
    await settle();
    const onReady = vi.fn();
    decodedRasterDisplay(JPEG_URL, image(64, 64), onReady);

    pruneDecodedRasterDisplays(new Set());
    await settle();

    expect(decoder.bitmaps).toHaveLength(2);
    for (const bitmap of decoder.bitmaps) expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('leaves a picture past the pixel budget on its <img> until another is dropped', async () => {
    const decoder = stubDecoder({ width: 8000, height: 8000 });
    const urls = ['AAA1', 'AAA2', 'AAA3', 'AAA4'].map(
      (payload) => `data:image/png;base64,${payload}`,
    );
    const last = urls[3] ?? '';
    for (const url of urls) decodedRasterDisplay(url, image(8000, 8000));
    await settle();

    // Three 4096 px copies fill the 192 MiB budget.
    expect(decoder.calls).toHaveLength(3);
    expect(decodedRasterDisplay(last, image(8000, 8000))).toBeNull();

    pruneDecodedRasterDisplays(new Set(urls.slice(1)));
    decodedRasterDisplay(last, image(8000, 8000));
    await settle();
    expect(decoder.calls).toHaveLength(4);
  });
});

/** A createImageBitmap that decodes to `natural`, resized as asked. */
function stubDecoder(natural: Size, undecodableUrl?: string): Decoder {
  const calls: DecodeCall[] = [];
  const bitmaps: FakeBitmap[] = [];
  const undecodableBytes =
    undecodableUrl === undefined ? -1 : atob(undecodableUrl.split(',')[1] ?? '').length;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (blob: Blob, options?: ImageBitmapOptions) => {
      calls.push({ blob, options });
      if (blob.size === undecodableBytes) throw new Error('The source image could not be decoded.');
      const bitmap = {
        width: options?.resizeWidth ?? natural.width,
        height: options?.resizeHeight ?? natural.height,
        close: vi.fn(),
      };
      bitmaps.push(bitmap);
      return bitmap;
    }),
  );
  return { calls, bitmaps };
}

function image(width: number, height: number): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height } as HTMLImageElement;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// jsdom's Blob has no arrayBuffer(); its FileReader reads one.
function blobBytes(blob: Blob | undefined): Promise<ArrayBuffer> {
  if (blob === undefined) throw new Error('expected a decoded blob');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('could not read the decoded blob'));
    reader.readAsArrayBuffer(blob);
  });
}
