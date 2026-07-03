import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { despeckle, hasImpulseNoise, medianFilter, otsuThreshold } from './preprocess';
import type { RawImageData } from './trace-image';

// ITU-R BT.601 luma, rounded — matches preprocess.ts's lumaAt exactly. The
// naive reference median below must classify pixels identically to the
// implementation under test, so it derives the median from these same luma
// values rather than from a separate colour model.
function naiveLuma(data: Uint8ClampedArray, offset: number): number {
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

// Deliberately naive 3×3 median: gather neighbours, full JS sort, take the
// middle. This is the exact semantics the fast in-place median must preserve,
// so the property test can assert byte-equality against it.
function naiveMedianFilter(image: RawImageData): RawImageData {
  const { width: w, height: h, data } = image;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const samples: number[] = [];
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          samples.push(naiveLuma(data, (ny * w + nx) * 4));
        }
      }
      samples.sort((a, b) => a - b);
      const median = samples[samples.length >> 1] ?? 0;
      const pi = (y * w + x) * 4;
      out[pi] = median;
      out[pi + 1] = median;
      out[pi + 2] = median;
      out[pi + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Random RGBA image up to 12×12 for the property tests. Small on purpose:
// borders (the count < 9 insertion-sort path) are a large fraction of the
// pixels, so the network and border paths both get heavy coverage.
const randomImage = fc
  .tuple(fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 12 }))
  .chain(([w, h]) =>
    fc
      .array(fc.integer({ min: 0, max: 255 }), {
        minLength: w * h * 4,
        maxLength: w * h * 4,
      })
      .map((bytes): RawImageData => ({ width: w, height: h, data: new Uint8ClampedArray(bytes) })),
  );

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

  it('is byte-identical to a naive reference median over random small images', () => {
    // The fast median (fixed 9-element network for interior pixels,
    // insertion sort for borders) must produce EXACTLY the same bytes as the
    // straightforward gather-sort-middle reference — the optimisation is
    // purely for speed and may not change a single output pixel.
    fc.assert(
      fc.property(randomImage, (image) => {
        const fast = medianFilter(image);
        const naive = naiveMedianFilter(image);
        expect(Array.from(fast.data)).toEqual(Array.from(naive.data));
      }),
      { numRuns: 40 },
    );
  });
});

describe('hasImpulseNoise', () => {
  it('reports false for a clean image with no salt-and-pepper', () => {
    // A crisp black-on-white glyph edge: the median changes anti-aliasing-free
    // pixels by 0, so the impulse ratio is 0 — no median should be applied.
    const img = gridImage([
      [0, 0, 0, 255, 255, 255],
      [0, 0, 0, 255, 255, 255],
      [0, 0, 0, 255, 255, 255],
      [0, 0, 0, 255, 255, 255],
    ]);
    expect(hasImpulseNoise(img)).toBe(false);
  });

  it('reports true for an image peppered with isolated salt pixels', () => {
    // ~11% of pixels flipped to the opposite extreme (values the 3×3 median
    // reverts by ~255) — well over the impulse ratio floor.
    const width = 12;
    const height = 12;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const salt = i % 9 === 0; // isolated speckle
      const v = salt ? 255 : 0;
      const o = i * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
    expect(hasImpulseNoise({ width, height, data })).toBe(true);
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
