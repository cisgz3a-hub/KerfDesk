import { describe, expect, it } from 'vitest';
import { toGrayImage } from './gray';

describe('toGrayImage', () => {
  it('converts RGBA to Rec.601 luma', () => {
    // One red, one green, one blue, one white pixel.
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255,
    ]);
    const gray = toGrayImage({ data, width: 4, height: 1 });
    expect(gray.width).toBe(4);
    expect(gray.height).toBe(1);
    expect(gray.data[0]).toBeCloseTo(255 * 0.299, 3);
    expect(gray.data[1]).toBeCloseTo(255 * 0.587, 3);
    expect(gray.data[2]).toBeCloseTo(255 * 0.114, 3);
    expect(gray.data[3]).toBeCloseTo(255, 3);
  });

  it('is invariant to the alpha channel', () => {
    const opaque = new Uint8ClampedArray([100, 150, 200, 255]);
    const transparent = new Uint8ClampedArray([100, 150, 200, 0]);
    const a = toGrayImage({ data: opaque, width: 1, height: 1 });
    const b = toGrayImage({ data: transparent, width: 1, height: 1 });
    expect(a.data[0]).toBe(b.data[0]);
  });
});
