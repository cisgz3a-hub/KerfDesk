import { describe, expect, it, vi } from 'vitest';
import { compositeRgbOverWhitePreservingAlpha, extractLumaBase64 } from '../trace/image-loader';
import { decodeImageLuma, type ImageLumaDecodeHost } from './image-luma-decode';

// The loader's luma builder as it stood before S3-P2-1 (one string append per
// pixel, then btoa), kept verbatim so the new routes are checked against the
// bytes every existing project was compiled from.
function legacyExtractLumaBase64(image: {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}): string {
  const pixelCount = image.width * image.height;
  const buf = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const r = image.data[i * 4] ?? 0;
    const g = image.data[i * 4 + 1] ?? 0;
    const b = image.data[i * 4 + 2] ?? 0;
    buf[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  let bin = '';
  for (const v of buf) bin += String.fromCharCode(v);
  return btoa(bin);
}

function legacyComposite(data: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 255;
    const opacity = alpha / 255;
    for (let c = 0; c < 3; c += 1) {
      out[i + c] = Math.round((data[i + c] ?? 0) * opacity + 255 * (1 - opacity));
    }
    out[i + 3] = alpha;
  }
  return out;
}

// Deterministic RGBA with every alpha value, edge channels and opaque runs.
function photoRgba(width: number, height: number, seed = 7): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    return state >>> 24;
  };
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = i % 97 === 0 ? 255 : next();
    data[i * 4 + 1] = i % 89 === 0 ? 0 : next();
    data[i * 4 + 2] = next();
    data[i * 4 + 3] = i % 3 === 0 ? 255 : i % 256;
  }
  return data;
}

function fakeHost(rgba: Uint8ClampedArray, width: number, height: number) {
  const close = vi.fn();
  const createImageBitmap = vi.fn(
    async (_image: Blob, _options: ImageBitmapOptions) =>
      ({ width, height, close }) as unknown as ImageBitmap,
  );
  const drawImage = vi.fn();
  const host: ImageLumaDecodeHost = {
    createImageBitmap,
    createContext: () => ({ drawImage, getImageData: () => ({ data: rgba }) }),
  };
  return { host, createImageBitmap, drawImage, close };
}

describe('decodeImageLuma (photo import worker)', () => {
  it("gives the UI-thread loader's luma bytes exactly, transparent pixels included", async () => {
    const width = 301;
    const height = 207;
    const rgba = photoRgba(width, height);
    const { host } = fakeHost(rgba, width, height);

    const result = await decodeImageLuma(
      { file: new Blob(), target: { width, height }, resize: false, maxEdge: 8192 },
      host,
    );

    const legacy = legacyExtractLumaBase64({ width, height, data: legacyComposite(rgba) });
    const loader = extractLumaBase64(
      compositeRgbOverWhitePreservingAlpha({ width, height, data: rgba }),
    );
    expect(loader).toBe(legacy);
    expect(result).toEqual({ kind: 'ok', width, height, lumaBase64: legacy });
  });

  it("keeps the loader's chunked luma identical past one base64 chunk", () => {
    const width = 512;
    const height = 300;
    const data = legacyComposite(photoRgba(width, height, 3));
    expect(extractLumaBase64({ width, height, data })).toBe(
      legacyExtractLumaBase64({ width, height, data }),
    );
  });

  it("asks the browser for the header's oriented grid, resized only when the loader resizes", async () => {
    const rgba = photoRgba(40, 30);
    const plain = fakeHost(rgba, 40, 30);
    await decodeImageLuma(
      { file: new Blob(), target: { width: 40, height: 30 }, resize: false, maxEdge: 8192 },
      plain.host,
    );
    expect(plain.createImageBitmap.mock.calls[0]?.[1]).toEqual({ imageOrientation: 'from-image' });
    expect(plain.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 40, 30);
    expect(plain.close).toHaveBeenCalledOnce();

    const resized = fakeHost(rgba, 40, 30);
    await decodeImageLuma(
      { file: new Blob(), target: { width: 40, height: 30 }, resize: true, maxEdge: 40 },
      resized.host,
    );
    expect(resized.createImageBitmap.mock.calls[0]?.[1]).toEqual({
      resizeWidth: 40,
      resizeHeight: 30,
      resizeQuality: 'high',
      imageOrientation: 'from-image',
    });
  });

  it('declines a decode that would need the canvas to scale or turn it', async () => {
    // An engine that ignored the EXIF turn returns the stored, swapped grid.
    const turned = fakeHost(photoRgba(30, 40), 30, 40);
    await expect(
      decodeImageLuma(
        { file: new Blob(), target: { width: 40, height: 30 }, resize: false, maxEdge: 8192 },
        turned.host,
      ),
    ).resolves.toMatchObject({ kind: 'fallback' });
    expect(turned.drawImage).not.toHaveBeenCalled();
    expect(turned.close).toHaveBeenCalledOnce();

    // Unparsed header: the loader would scale an over-cap element on its canvas.
    const overCap = fakeHost(photoRgba(50, 20), 50, 20);
    await expect(
      decodeImageLuma({ file: new Blob(), target: null, resize: false, maxEdge: 25 }, overCap.host),
    ).resolves.toMatchObject({ kind: 'fallback' });
  });

  it("takes an unparsed header's natural grid when it is within the cap", async () => {
    const rgba = photoRgba(50, 20);
    const { host } = fakeHost(rgba, 50, 20);
    await expect(
      decodeImageLuma({ file: new Blob(), target: null, resize: false, maxEdge: 8192 }, host),
    ).resolves.toMatchObject({ kind: 'ok', width: 50, height: 20 });
  });
});
