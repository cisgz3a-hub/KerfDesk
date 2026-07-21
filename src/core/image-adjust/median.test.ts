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
