import { describe, expect, it } from 'vitest';
import { assessPicture } from './picture-quality';
import type { RgbaImage } from './rgba-image';

function frame(width: number, height: number, pixel: (x: number, y: number) => number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = pixel(x, y);
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

const BED = { widthMm: 400, heightMm: 400 };

describe('assessPicture', () => {
  it('passes an evenly lit picture', () => {
    const quality = assessPicture(
      frame(64, 48, () => 140),
      BED,
    );
    expect(quality?.brightness).toBe('ok');
    expect(quality?.meanLuma).toBeCloseTo(140, 0);
    expect(quality?.washedOutFraction).toBe(0);
  });

  it('calls a dim picture dark', () => {
    expect(
      assessPicture(
        frame(64, 48, () => 30),
        BED,
      )?.brightness,
    ).toBe('dark');
  });

  it('calls a picture with a glare patch washed out even when its average is fine', () => {
    // A tenth of the picture is clipped white; the rest is mid grey.
    const quality = assessPicture(
      frame(100, 100, (x) => (x < 10 ? 255 : 120)),
      BED,
    );
    expect(quality?.brightness).toBe('washed-out');
    expect(quality?.washedOutFraction).toBeCloseTo(0.1, 2);
  });

  it('gives the finest bed millimetres per pixel the picture size allows', () => {
    // A 400 × 300 mm bed in a 1920 × 1080 picture: the long sides limit it.
    const quality = assessPicture(
      frame(1920, 1080, () => 128),
      { widthMm: 400, heightMm: 300 },
    );
    expect(quality?.bestMmPerPixel).toBeCloseTo(Math.max(400 / 1920, 300 / 1080), 6);
  });

  it('measures nothing on an empty frame or an unknown bed', () => {
    expect(assessPicture({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, BED)).toBeNull();
    expect(
      assessPicture(
        frame(8, 8, () => 128),
        { widthMm: 0, heightMm: 400 },
      )?.bestMmPerPixel,
    ).toBeNull();
  });

  it('samples a large frame instead of reading every pixel', () => {
    // 2000 × 1500 would be 3 million reads; the result still matches a flat frame.
    const quality = assessPicture(
      frame(2000, 1500, () => 200),
      BED,
    );
    expect(quality?.meanLuma).toBeCloseTo(200, 0);
  });
});
