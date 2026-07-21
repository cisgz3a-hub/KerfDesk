import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { unsharpMaskInPlace } from './unsharp-mask';

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? 0;
}

function halfAndHalf(width: number, height: number, dark: number, light: number) {
  const doc = createRgbaBuffer(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const base = (y * width + x) * 4;
      const value = x < width / 2 ? dark : light;
      doc.data[base] = value;
      doc.data[base + 1] = value;
      doc.data[base + 2] = value;
    }
  }
  return doc;
}

describe('unsharpMaskInPlace', () => {
  it('increases contrast across an edge', () => {
    const doc = halfAndHalf(10, 3, 100, 200);
    unsharpMaskInPlace(doc, { amountPercent: 100, sigma: 1, threshold: 0 }, null, null);
    expect(grey(doc, 4, 1)).toBeLessThan(100);
    expect(grey(doc, 5, 1)).toBeGreaterThan(200);
  });

  it('threshold suppresses low-contrast differences', () => {
    const doc = halfAndHalf(10, 3, 120, 130);
    unsharpMaskInPlace(doc, { amountPercent: 100, sigma: 1, threshold: 50 }, null, null);
    expect(grey(doc, 4, 1)).toBe(120);
    expect(grey(doc, 5, 1)).toBe(130);
  });

  it('leaves flat areas alone', () => {
    const doc = createRgbaBuffer(8, 8);
    unsharpMaskInPlace(doc, { amountPercent: 500, sigma: 2, threshold: 0 }, null, null);
    expect(grey(doc, 4, 4)).toBe(255);
  });
});
