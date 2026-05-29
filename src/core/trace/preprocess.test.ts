import { describe, expect, it } from 'vitest';
import { despeckle, medianFilter, otsuThreshold } from './preprocess';
import type { RawImageData } from './trace-image';

// Build a RawImageData from a grid of luma values. Each entry is
// duplicated across R/G/B; alpha = 255. Tests read clearly when the
// grid layout matches the visual interpretation (row-major).
function gridImage(luma: ReadonlyArray<ReadonlyArray<number>>): RawImageData {
  const height = luma.length;
  const width = luma[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = luma[y]?.[x] ?? 0;
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function lumaOf(img: RawImageData, x: number, y: number): number {
  return img.data[(y * img.width + x) * 4] ?? 0;
}

describe('otsuThreshold', () => {
  it('picks a cutoff between the two histogram peaks for a clear bimodal image', () => {
    // 50/50 black-and-white image: Otsu should land somewhere between
    // 0 and 255 — typically right around the midpoint for perfectly
    // bimodal histograms.
    const img = gridImage([
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    const t = otsuThreshold(img);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(255);
  });

  it('handles uniform images without throwing or returning NaN', () => {
    const img = gridImage([
      [128, 128],
      [128, 128],
    ]);
    const t = otsuThreshold(img);
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(255);
  });

  it('returns a value that better separates ink-vs-background than 128 on dim-on-light input', () => {
    // Foreground luma 80, background luma 200 — fixed-128 would put
    // the foreground (80) below cutoff and the background (200) above,
    // which is correct, but Otsu picks a value somewhere in the
    // 80-200 gap that maximises between-class variance. Anywhere
    // in that gap qualifies as "well-separated".
    const img = gridImage([
      [80, 80, 200, 200],
      [80, 80, 200, 200],
      [80, 80, 200, 200],
    ]);
    const t = otsuThreshold(img);
    expect(t).toBeGreaterThan(80);
    expect(t).toBeLessThan(200);
  });
});

describe('medianFilter', () => {
  it('replaces a single salt pixel in a uniform field with the dominant neighbour', () => {
    // 3×3 grid of black pixels with one white salt in the centre.
    // The centre's 3×3 neighbourhood is 8 black + 1 white; median is
    // black. Centre flips back to 0.
    const img = gridImage([
      [0, 0, 0],
      [0, 255, 0],
      [0, 0, 0],
    ]);
    const out = medianFilter(img);
    expect(lumaOf(out, 1, 1)).toBe(0);
  });

  it('replaces a single pepper pixel in a white field with white', () => {
    const img = gridImage([
      [255, 255, 255],
      [255, 0, 255],
      [255, 255, 255],
    ]);
    const out = medianFilter(img);
    expect(lumaOf(out, 1, 1)).toBe(255);
  });

  it('preserves a real edge — column boundary between black and white', () => {
    // Edge across the middle column. Each median sample sees an
    // equal split, so the centre column's median falls on whichever
    // side dominates by one pixel. Both sides remain visually distinct.
    const img = gridImage([
      [0, 0, 0, 255, 255, 255],
      [0, 0, 0, 255, 255, 255],
      [0, 0, 0, 255, 255, 255],
    ]);
    const out = medianFilter(img);
    // Far-left and far-right preserve their values.
    expect(lumaOf(out, 0, 1)).toBe(0);
    expect(lumaOf(out, 5, 1)).toBe(255);
  });

  it('does not mutate the input', () => {
    const img = gridImage([
      [0, 255, 0],
      [255, 0, 255],
      [0, 255, 0],
    ]);
    const before = Array.from(img.data);
    medianFilter(img);
    expect(Array.from(img.data)).toEqual(before);
  });
});

describe('despeckle', () => {
  it('removes a single isolated ink pixel when minPixels=2', () => {
    const img = gridImage([
      [255, 255, 255],
      [255, 0, 255],
      [255, 255, 255],
    ]);
    const out = despeckle(img, 2);
    expect(lumaOf(out, 1, 1)).toBe(255);
  });

  it('keeps a large ink region untouched', () => {
    const img = gridImage([
      [0, 0, 0, 255, 255],
      [0, 0, 0, 255, 255],
      [0, 0, 0, 255, 255],
    ]);
    const out = despeckle(img, 4);
    // 3×3 ink region = 9 pixels, well above the 4-pixel minimum.
    expect(lumaOf(out, 0, 0)).toBe(0);
    expect(lumaOf(out, 2, 2)).toBe(0);
  });

  it('treats 4-connected speckles as separate regions', () => {
    // Two diagonally-touching ink pixels are NOT connected under
    // 4-connectivity, so each is its own 1-pixel region. With
    // minPixels=2 both vanish.
    const img = gridImage([
      [0, 255, 255],
      [255, 0, 255],
      [255, 255, 255],
    ]);
    const out = despeckle(img, 2);
    expect(lumaOf(out, 0, 0)).toBe(255);
    expect(lumaOf(out, 1, 1)).toBe(255);
  });

  it('preserves holes inside letter-like shapes (topology preserving)', () => {
    // 5×5 ink ring with a white hole in the middle — like the
    // interior of a letter O. The hole is a 1-pixel BACKGROUND
    // region; despeckle ONLY removes ink regions below threshold,
    // so the hole survives. (Was the bug this test pins.)
    const img = gridImage([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 255, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    const out = despeckle(img, 5);
    expect(lumaOf(out, 2, 2)).toBe(255); // hole preserved
    expect(lumaOf(out, 0, 0)).toBe(0); // ring preserved
  });

  it('is a no-op when minPixels <= 1', () => {
    const img = gridImage([
      [0, 255],
      [255, 0],
    ]);
    const out = despeckle(img, 1);
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });
});
