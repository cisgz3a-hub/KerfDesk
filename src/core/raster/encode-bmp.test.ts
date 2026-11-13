import { describe, expect, it } from 'vitest';
import { decodeBmp } from '../../io/raster-decode/decode-bmp-pnm';
import { encodeBmp24, encodeBmp8Grey } from './encode-bmp';

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

describe('encodeBmp8Grey', () => {
  it('round-trips greys through the BMP decoder, padding widths to four bytes', () => {
    const luma = Uint8Array.from([0, 64, 128, 255, 7, 200]);
    const decoded = decodeBmp(encodeBmp8Grey(luma, 3, 2));
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    const greys = Array.from({ length: 6 }, (_, index) => decoded.data[index * 4]);
    expect(greys).toEqual(Array.from(luma));
    expect(decoded.data[1]).toBe(0);
    expect(decoded.data[3]).toBe(255);
  });

  it('is a third of the 24-bit size for a large image', () => {
    const luma = new Uint8Array(200 * 200).fill(90);
    const rgba = new Uint8ClampedArray(200 * 200 * 4).fill(255);
    expect(encodeBmp8Grey(luma, 200, 200).length * 2.8).toBeLessThan(
      encodeBmp24(rgba, 200, 200).length,
    );
  });

  it('refuses an empty or short image', () => {
    expect(() => encodeBmp8Grey(new Uint8Array(), 0, 1)).toThrow();
    expect(() => encodeBmp8Grey(new Uint8Array(3), 2, 2)).toThrow();
  });
});
