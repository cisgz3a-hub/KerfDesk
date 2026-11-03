import { describe, expect, it, vi } from 'vitest';
import { compositeRgbOverWhitePreservingAlpha, extractLumaBase64 } from '../trace/image-loader';
import { lumaFromDrawnImage } from './image-luma-decode';

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

function fakeBitmap(width: number, height: number) {
  const close = vi.fn();
  return { bitmap: { width, height, close } as unknown as ImageBitmap, close };
}

function readback(rgba: Uint8ClampedArray) {
  const drawImage = vi.fn();
  const getImageData = vi.fn(() => ({ data: rgba }));
  return { context: { drawImage, getImageData }, drawImage, getImageData };
}

describe('lumaFromDrawnImage (photo import worker)', () => {
  it("gives the UI-thread loader's luma bytes exactly, transparent pixels included", () => {
    const width = 301;
    const height = 207;
    const rgba = photoRgba(width, height);
    const { bitmap, close } = fakeBitmap(width, height);
    const { context, drawImage, getImageData } = readback(rgba);
    const createContext = vi.fn(() => context);

    const result = lumaFromDrawnImage(bitmap, createContext);

    const legacy = legacyExtractLumaBase64({ width, height, data: legacyComposite(rgba) });
    const loader = extractLumaBase64(
      compositeRgbOverWhitePreservingAlpha({ width, height, data: rgba }),
    );
    expect(loader).toBe(legacy);
    expect(result).toEqual({ kind: 'ok', width, height, lumaBase64: legacy });
    // A 1:1 copy of the snapshot at its own size, read back whole.
    expect(createContext).toHaveBeenCalledWith(width, height);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(getImageData).toHaveBeenCalledWith(0, 0, width, height);
    expect(close).toHaveBeenCalledOnce();
  });

  it("keeps the loader's chunked luma identical past one base64 chunk", () => {
    const width = 512;
    const height = 300;
    const data = legacyComposite(photoRgba(width, height, 3));
    expect(extractLumaBase64({ width, height, data })).toBe(
      legacyExtractLumaBase64({ width, height, data }),
    );
  });

  it('reports a failure, and still releases the snapshot, when it cannot read it', () => {
    const missing = fakeBitmap(4, 3);
    expect(lumaFromDrawnImage(missing.bitmap, () => null)).toMatchObject({ kind: 'failed' });
    expect(missing.close).toHaveBeenCalledOnce();

    const throwing = fakeBitmap(4, 3);
    const result = lumaFromDrawnImage(throwing.bitmap, () => ({
      drawImage: () => {
        throw new Error('context lost');
      },
      getImageData: () => ({ data: new Uint8ClampedArray(48) }),
    }));
    expect(result).toEqual({ kind: 'failed', reason: 'context lost' });
    expect(throwing.close).toHaveBeenCalledOnce();
  });
});
