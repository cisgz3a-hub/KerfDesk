// ADR-029 §4 — the pure halves of the luma→bitmap encode. lumaToBitmap
// itself needs a real canvas (toDataURL), which jsdom lacks, so it is
// verified in-browser (A2-v); here we pin the two DOM-free helpers it
// composes: grey RGBA expansion and base64 luma transit.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VectorRaster } from '../../core/raster';
import { lumaToBase64, lumaToBitmap, lumaToRgba } from './luma-bitmap';

function raster(luma: ReadonlyArray<number>, width: number, height: number): VectorRaster {
  return { luma: new Uint8Array(luma), width, height };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('lumaToRgba', () => {
  it('replicates each luma byte across R,G,B with opaque alpha', () => {
    const rgba = lumaToRgba(raster([128, 255], 2, 1));
    expect(Array.from(rgba)).toEqual([128, 128, 128, 255, 255, 255, 255, 255]);
  });

  it('produces width*height*4 RGBA bytes', () => {
    expect(lumaToRgba(raster(new Array(6).fill(128), 3, 2))).toHaveLength(24);
  });

  it('falls back to white for pixels beyond the luma buffer length', () => {
    // width*height = 2 but only one luma byte → the missing pixel reads as
    // paper (255), never as black ink.
    const rgba = lumaToRgba(raster([0], 2, 1));
    expect(Array.from(rgba)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe('lumaToBase64', () => {
  it('base64-encodes the luma buffer so atob round-trips to the same bytes', () => {
    const luma = new Uint8Array([0, 128, 255, 7]);
    const decoded = atob(lumaToBase64(luma));
    const bytes = Uint8Array.from(decoded, (c) => c.charCodeAt(0));
    expect(Array.from(bytes)).toEqual([0, 128, 255, 7]);
  });

  it('encodes an empty buffer as an empty string', () => {
    expect(lumaToBase64(new Uint8Array(0))).toBe('');
  });
});

describe('lumaToBitmap', () => {
  it('encodes canvas output through async toBlob instead of synchronous toDataURL', async () => {
    const toBlob = vi.fn((cb: BlobCallback, mime: string) => {
      cb(new Blob(['png'], { type: mime }));
    });
    const toDataURL = vi.fn(() => 'data:image/png;base64,sync');
    vi.spyOn(document, 'createElement').mockReturnValue({
      width: 0,
      height: 0,
      getContext: () => ({
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
        putImageData: vi.fn(),
      }),
      toBlob,
      toDataURL,
    } as unknown as HTMLCanvasElement);
    vi.stubGlobal('FileReader', FakeFileReader);

    const result = await lumaToBitmap(raster([0], 1, 1));

    expect(result.dataUrl).toBe('data:image/png;base64,async');
    expect(result.lumaBase64).toBe('AA==');
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    expect(toDataURL).not.toHaveBeenCalled();
  });
});

class FakeFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

  readAsDataURL(): void {
    this.result = 'data:image/png;base64,async';
    this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
  }
}
