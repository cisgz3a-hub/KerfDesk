import { describe, expect, it } from 'vitest';
import type { RgbaBuffer } from '../image-edit';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { boxBlurredRect, extendedBox } from './box-blur';
import { gaussianBlurInPlace } from './gaussian-blur';

// Three boxes are not quite Gaussian in shape even at the same variance. The
// hard edge is the worst case here, measured at 2.9 to 4.1 levels; noise 0.8 to 1.7.
const TOLERANCE_LEVELS = 5;

describe('three-box Gaussian approximation', () => {
  it.each([2, 2.5, 3, 5, 10, 25, 50])(
    'stays within a few levels of the exact Gaussian at sigma %d',
    (sigma) => {
      for (const doc of [noiseImage(37, 29), edgeImage(37, 29)]) {
        const rect = { x: 0, y: 0, width: doc.width, height: doc.height };
        const approx = boxBlurredRect(doc, sigma, rect);
        const exact = exactGaussian(doc, sigma);
        expect(maxDifference(approx, exact)).toBeLessThanOrEqual(TOLERANCE_LEVELS);
      }
    },
  );

  it('has exactly the variance of the Gaussian it stands in for', () => {
    for (const sigma of [2, 2.5, 3.5, 8, 50]) {
      const { radius, endWeight } = extendedBox(sigma);
      // Sum of k^2 w(k) over one pass, three passes in all.
      const moment =
        (radius * (radius + 1) * (2 * radius + 1)) / 3 + 2 * endWeight * (radius + 1) ** 2;
      const passVariance = moment / (2 * radius + 1 + 2 * endWeight);
      expect(endWeight).toBeGreaterThanOrEqual(0);
      expect(endWeight).toBeLessThan(1);
      expect(3 * passVariance).toBeCloseTo(sigma * sigma, 9);
    }
  });

  it('blurs a rect from its true neighbours, as a whole-document blur does', () => {
    const doc = noiseImage(40, 30);
    const whole = boxBlurredRect(doc, 6, { x: 0, y: 0, width: 40, height: 30 });
    const rect = { x: 11, y: 7, width: 9, height: 13 };
    const part = boxBlurredRect(doc, 6, rect);
    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        for (let c = 0; c < 3; c += 1) {
          const inWhole = whole[((rect.y + y) * 40 + rect.x + x) * 3 + c] ?? NaN;
          expect(part[(y * rect.width + x) * 3 + c]).toBeCloseTo(inWhole, 3);
        }
      }
    }
  });

  it('leaves a uniform image uniform and spreads a dot symmetrically', () => {
    const flat = createRgbaBuffer(9, 7);
    gaussianBlurInPlace(flat, 20, null, null);
    expect(new Set(flat.data)).toEqual(new Set([255]));
    const dot = createRgbaBuffer(21, 21);
    setGrey(dot, 10, 10, 0);
    gaussianBlurInPlace(dot, 3, null, null);
    expect(grey(dot, 10, 10)).toBeLessThan(255);
    expect(grey(dot, 7, 10)).toBe(grey(dot, 13, 10));
    expect(grey(dot, 10, 7)).toBe(grey(dot, 10, 13));
    expect(grey(dot, 7, 10)).toBe(grey(dot, 10, 7));
  });
});

// The separable kernel the box blurs stand in for, with the document's edge
// pixels repeated beyond it.
function exactGaussian(doc: RgbaBuffer, sigma: number): Float64Array {
  const radius = Math.ceil(3 * sigma);
  const weights = Array.from({ length: 2 * radius + 1 }, (_, i) =>
    Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const at = (x: number, y: number, c: number): number => {
    const cx = Math.min(doc.width - 1, Math.max(0, x));
    const cy = Math.min(doc.height - 1, Math.max(0, y));
    return doc.data[(cy * doc.width + cx) * 4 + c] ?? 0;
  };
  const rows = new Float64Array(doc.width * doc.height * 3);
  const out = new Float64Array(doc.width * doc.height * 3);
  forEachSample(doc, (x, y, c) => {
    let sum = 0;
    weights.forEach((weight, i) => (sum += at(x + i - radius, y, c) * weight));
    rows[(y * doc.width + x) * 3 + c] = sum / total;
  });
  const row = (x: number, y: number, c: number): number =>
    rows[(Math.min(doc.height - 1, Math.max(0, y)) * doc.width + x) * 3 + c] ?? 0;
  forEachSample(doc, (x, y, c) => {
    let sum = 0;
    weights.forEach((weight, i) => (sum += row(x, y + i - radius, c) * weight));
    out[(y * doc.width + x) * 3 + c] = sum / total;
  });
  return out;
}

function forEachSample(doc: RgbaBuffer, visit: (x: number, y: number, c: number) => void): void {
  for (let y = 0; y < doc.height; y += 1) {
    for (let x = 0; x < doc.width; x += 1) {
      for (let c = 0; c < 3; c += 1) visit(x, y, c);
    }
  }
}

function maxDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < a.length; i += 1) max = Math.max(max, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return max;
}

function noiseImage(width: number, height: number): RgbaBuffer {
  const doc = createRgbaBuffer(width, height);
  let seed = 12345;
  for (let i = 0; i < doc.data.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    doc.data[i] = i % 4 === 3 ? 255 : seed % 256;
  }
  return doc;
}

// Black left half, white right half, with a dark bar across the top rows.
function edgeImage(width: number, height: number): RgbaBuffer {
  const doc = createRgbaBuffer(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < width / 2 || y < 3) setGrey(doc, x, y, 0);
    }
  }
  return doc;
}

function grey(doc: RgbaBuffer, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? 0;
}

function setGrey(doc: RgbaBuffer, x: number, y: number, value: number): void {
  const base = (y * doc.width + x) * 4;
  doc.data[base] = value;
  doc.data[base + 1] = value;
  doc.data[base + 2] = value;
}
