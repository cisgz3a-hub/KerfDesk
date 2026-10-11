// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { psdDocument } from '../../__fixtures__/psd-document';
import { preparePsdImport } from './psd-import-preparation';

afterEach(() => vi.unstubAllGlobals());

describe('PSD worker preparation', () => {
  it('retains straight alpha for the PNG and composites luminance on white once', async () => {
    let encoded: number[] = [];
    class Canvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return {
          createImageData: (w: number, h: number) => ({
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4),
          }),
          putImageData: (pixels: ImageData) => {
            encoded = [...pixels.data];
          },
        };
      }
      convertToBlob() {
        return Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
      }
    }
    vi.stubGlobal('OffscreenCanvas', Canvas);
    const prepared = await preparePsdImport(
      new Blob([
        psdDocument({ gray: true, alpha: true, mergedAlpha: true, resolution: [100, 2, 150, 1] }),
      ]),
    );
    expect(encoded).toEqual([255, 255, 255, 0, 90, 90, 90, 128, 255, 255, 255, 255]);
    expect([...Buffer.from(prepared.lumaBase64, 'base64')]).toEqual([255, 172, 255]);
    expect(prepared.density).toEqual({ xDpi: 100, yDpi: 150 });
    expect(prepared.natural).toEqual({ width: 3, height: 1 });
    expect(prepared.sampled).toEqual(prepared.natural);
    expect(prepared.dataUrl).toBe('data:image/png;base64,AQID');
  });
  it('rejects impossible dimensions from the prefix without reading the complete file', async () => {
    const bytes = psdDocument();
    new DataView(bytes.buffer).setUint32(18, 0xffffffff);
    const blob = new Blob([bytes]);
    const read = vi.spyOn(blob, 'arrayBuffer');
    await expect(preparePsdImport(blob)).rejects.toThrow(/limit|canvas/);
    expect(read).not.toHaveBeenCalled();
  });
});
