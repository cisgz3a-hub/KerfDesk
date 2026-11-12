import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { createEmptyMask } from '../image-select/selection-mask';
import { medianInPlace } from './median';

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? 0;
}

function setGrey(
  doc: ReturnType<typeof createRgbaBuffer>,
  x: number,
  y: number,
  value: number,
): void {
  const base = (y * doc.width + x) * 4;
  doc.data[base] = value;
  doc.data[base + 1] = value;
  doc.data[base + 2] = value;
}

describe('medianInPlace', () => {
  it('erases isolated speckles', () => {
    const doc = createRgbaBuffer(7, 7);
    setGrey(doc, 3, 3, 0);
    medianInPlace(doc, 1, null, null);
    expect(grey(doc, 3, 3)).toBe(255);
  });

  it('preserves a straight edge exactly', () => {
    const doc = createRgbaBuffer(8, 8);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 4; x += 1) setGrey(doc, x, y, 0);
    }
    medianInPlace(doc, 1, null, null);
    expect(grey(doc, 3, 4)).toBe(0);
    expect(grey(doc, 4, 4)).toBe(255);
  });

  it('writes only masked pixels', () => {
    const doc = createRgbaBuffer(7, 1);
    setGrey(doc, 2, 0, 0);
    setGrey(doc, 5, 0, 0);
    const mask = createEmptyMask(7, 1);
    mask.alpha[2] = 255;
    medianInPlace(doc, 1, null, mask);
    expect(grey(doc, 2, 0)).toBe(255); // despeckled (selected)
    expect(grey(doc, 5, 0)).toBe(0); // untouched (unselected)
  });
});

// ADR-245 Amendment 2: the running histogram replaced a sort per window. The
// old gather-and-sort stays here as the reference: same bytes for every
// radius, rect and feathered mask, edge clamping included.
function sortedMedianReference(
  doc: ReturnType<typeof createRgbaBuffer>,
  radius: number,
  rect: { x: number; y: number; width: number; height: number },
  mask: { alpha: Uint8Array } | null,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(doc.data);
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const idx = y * doc.width + x;
      const alpha = mask === null ? 255 : (mask.alpha[idx] ?? 0);
      if (alpha === 0) continue;
      for (let c = 0; c < 3; c += 1) {
        const mapped = sortedWindowMedian(doc, x, y, radius, c);
        const source = doc.data[idx * 4 + c] ?? 0;
        out[idx * 4 + c] =
          alpha === 255 ? mapped : source + Math.round(((mapped - source) * alpha) / 255);
      }
    }
  }
  return out;
}

function sortedWindowMedian(
  doc: ReturnType<typeof createRgbaBuffer>,
  x: number,
  y: number,
  radius: number,
  c: number,
): number {
  const window: number[] = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    const sy = Math.min(doc.height - 1, Math.max(0, y + dy));
    for (let dx = -radius; dx <= radius; dx += 1) {
      const sx = Math.min(doc.width - 1, Math.max(0, x + dx));
      window.push(doc.data[(sy * doc.width + sx) * 4 + c] ?? 0);
    }
  }
  window.sort((a, b) => a - b);
  return window[(window.length - 1) >> 1] ?? 0;
}

describe('medianInPlace matches the sorted-window median byte for byte', () => {
  const W = 23;
  const H = 17;
  function noisy(seed: number): ReturnType<typeof createRgbaBuffer> {
    const doc = createRgbaBuffer(W, H);
    let state = seed;
    for (let i = 0; i < doc.data.length; i += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      // Few distinct levels on some channels, so ties are common.
      doc.data[i] = i % 4 === 1 ? (state >> 8) % 4 : (state >> 8) % 256;
    }
    return doc;
  }
  const RECTS = [
    { x: 0, y: 0, width: W, height: H },
    { x: 3, y: 2, width: 11, height: 9 },
    { x: 20, y: 0, width: 3, height: 17 },
  ];

  it.each([1, 2, 3, 4])('radius %i', (radius) => {
    for (const [i, rect] of RECTS.entries()) {
      for (const masked of [false, true]) {
        const doc = noisy(radius * 31 + i);
        const mask = masked ? createEmptyMask(W, H) : null;
        if (mask !== null) for (let p = 0; p < W * H; p += 1) mask.alpha[p] = (p * 37) % 256;
        const expected = sortedMedianReference(doc, radius, rect, mask);
        medianInPlace(doc, radius, rect, mask);
        expect([radius, i, masked, ...doc.data]).toEqual([radius, i, masked, ...expected]);
      }
    }
  });

  it('reports progress up to 1 without changing the result', () => {
    const plain = noisy(7);
    const reported = noisy(7);
    const seen: number[] = [];
    medianInPlace(plain, 2, null, null);
    medianInPlace(reported, 2, null, null, (fraction) => seen.push(fraction));
    expect(reported.data).toEqual(plain.data);
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });
});
