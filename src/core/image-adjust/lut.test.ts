import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { createEmptyMask } from '../image-select/selection-mask';
import { applyLumaLutInPlace, applyLutInPlace, clampRectToDoc } from './lut';
import { invertLut, thresholdLut } from './tone-luts';

function setPixel(
  doc: ReturnType<typeof createRgbaBuffer>,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
): void {
  const base = (y * doc.width + x) * 4;
  doc.data[base] = r;
  doc.data[base + 1] = g;
  doc.data[base + 2] = b;
}

function pixel(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number[] {
  const base = (y * doc.width + x) * 4;
  return [
    doc.data[base] ?? 0,
    doc.data[base + 1] ?? 0,
    doc.data[base + 2] ?? 0,
    doc.data[base + 3] ?? 0,
  ];
}

describe('applyLutInPlace', () => {
  it('maps every RGB channel and leaves alpha untouched', () => {
    const doc = createRgbaBuffer(2, 2);
    setPixel(doc, 0, 0, 10, 20, 30);
    applyLutInPlace(doc, invertLut(), null, null);
    expect(pixel(doc, 0, 0)).toEqual([245, 235, 225, 255]);
    expect(pixel(doc, 1, 1)).toEqual([0, 0, 0, 255]);
  });

  it('skips unselected pixels and lerps half-selected ones', () => {
    const doc = createRgbaBuffer(3, 1);
    setPixel(doc, 0, 0, 100, 100, 100);
    setPixel(doc, 1, 0, 100, 100, 100);
    setPixel(doc, 2, 0, 100, 100, 100);
    const mask = createEmptyMask(3, 1);
    mask.alpha[1] = 128;
    mask.alpha[2] = 255;
    applyLutInPlace(doc, invertLut(), null, mask);
    expect(pixel(doc, 0, 0)[0]).toBe(100);
    // invert(100) = 155; halfway = 100 + round(55 * 128/255) = 128
    expect(pixel(doc, 1, 0)[0]).toBe(128);
    expect(pixel(doc, 2, 0)[0]).toBe(155);
  });

  it('honours the rect and clamps it to the document', () => {
    const doc = createRgbaBuffer(4, 4);
    applyLutInPlace(doc, invertLut(), { x: 2, y: 2, width: 99, height: 99 }, null);
    expect(pixel(doc, 1, 1)[0]).toBe(255);
    expect(pixel(doc, 2, 2)[0]).toBe(0);
    expect(pixel(doc, 3, 3)[0]).toBe(0);
  });
});

describe('applyLumaLutInPlace', () => {
  it('thresholds a colored pixel to pure black or white by luma', () => {
    const doc = createRgbaBuffer(2, 1);
    setPixel(doc, 0, 0, 255, 0, 0); // luma 76 -> below 128 -> black
    setPixel(doc, 1, 0, 0, 255, 0); // luma 150 -> above 128 -> white
    applyLumaLutInPlace(doc, thresholdLut(128), null, null);
    expect(pixel(doc, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(doc, 1, 0)).toEqual([255, 255, 255, 255]);
  });
});

describe('clampRectToDoc', () => {
  it('returns the full document for a null rect', () => {
    const doc = createRgbaBuffer(7, 5);
    expect(clampRectToDoc(doc, null)).toEqual({ x: 0, y: 0, width: 7, height: 5 });
  });

  it('produces a non-positive span for a fully outside rect', () => {
    const doc = createRgbaBuffer(4, 4);
    const r = clampRectToDoc(doc, { x: 10, y: 10, width: 5, height: 5 });
    expect(r.width).toBeLessThanOrEqual(0);
  });
});
