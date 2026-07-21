import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { createEmptyMask } from '../image-select/selection-mask';
import { gaussianBlurInPlace } from './gaussian-blur';

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

describe('gaussianBlurInPlace', () => {
  it('leaves a uniform image untouched', () => {
    const doc = createRgbaBuffer(9, 9);
    gaussianBlurInPlace(doc, 2, null, null);
    expect(grey(doc, 0, 0)).toBe(255);
    expect(grey(doc, 4, 4)).toBe(255);
  });

  it('spreads a single black pixel symmetrically', () => {
    const doc = createRgbaBuffer(11, 11);
    setGrey(doc, 5, 5, 0);
    gaussianBlurInPlace(doc, 1, null, null);
    expect(grey(doc, 5, 5)).toBeGreaterThan(0);
    expect(grey(doc, 4, 5)).toBeLessThan(255);
    expect(grey(doc, 4, 5)).toBe(grey(doc, 6, 5));
    expect(grey(doc, 5, 4)).toBe(grey(doc, 5, 6));
    expect(grey(doc, 0, 0)).toBe(255);
  });

  it('reads outside the selection but writes only inside it', () => {
    const doc = createRgbaBuffer(5, 1);
    setGrey(doc, 2, 0, 0);
    const mask = createEmptyMask(5, 1);
    mask.alpha[1] = 255;
    gaussianBlurInPlace(doc, 1, null, mask);
    // The selected neighbour picked up ink from the unselected black pixel…
    expect(grey(doc, 1, 0)).toBeLessThan(255);
    // …and the unselected pixels are untouched.
    expect(grey(doc, 2, 0)).toBe(0);
    expect(grey(doc, 3, 0)).toBe(255);
  });

  it('is a no-op for sigma 0', () => {
    const doc = createRgbaBuffer(5, 5);
    setGrey(doc, 2, 2, 0);
    gaussianBlurInPlace(doc, 0, null, null);
    expect(grey(doc, 2, 2)).toBe(0);
    expect(grey(doc, 1, 2)).toBe(255);
  });
});
