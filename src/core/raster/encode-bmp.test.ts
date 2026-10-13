import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../io/raster-decode/decode-bmp-pnm';
import { encodeBmp24 } from './encode-bmp';

describe('encodeBmp24', () => {
  it('round-trips colours through the BMP decoder, padding odd widths', () => {
    const width = 3;
    const height = 2;
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255, 200, 100, 50, 255, 0, 0, 0,
      0,
    ]);
    const decoded = decodeBmp(encodeBmp24(rgba, width, height, 300));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    expect(Array.from(decoded.data.slice(0, 4 * 5))).toEqual(Array.from(rgba.slice(0, 4 * 5)));
    // A transparent pixel becomes white paper, fully opaque.
    expect(Array.from(decoded.data.slice(20, 24))).toEqual([255, 255, 255, 255]);
  });

  it('refuses an empty image', () => {
    expect(() => encodeBmp24(new Uint8ClampedArray(), 0, 1)).toThrow();
  });
});
