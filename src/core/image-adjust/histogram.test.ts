import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { createEmptyMask } from '../image-select/selection-mask';
import { lumaHistogram } from './histogram';

describe('lumaHistogram', () => {
  it('counts every pixel of a fresh (white) document at bin 255', () => {
    const doc = createRgbaBuffer(4, 3);
    const bins = lumaHistogram(doc, null, null);
    expect(bins[255]).toBe(12);
    expect(bins.reduce((a, b) => a + b, 0)).toBe(12);
  });

  it('bins colored pixels by Rec.601 luma', () => {
    const doc = createRgbaBuffer(1, 1);
    doc.data[0] = 255;
    doc.data[1] = 0;
    doc.data[2] = 0;
    const bins = lumaHistogram(doc, null, null);
    expect(bins[76]).toBe(1); // round(0.299 * 255)
  });

  it('restricts to the rect and to sufficiently-selected mask pixels', () => {
    const doc = createRgbaBuffer(4, 1);
    const rectOnly = lumaHistogram(doc, { x: 0, y: 0, width: 2, height: 1 }, null);
    expect(rectOnly.reduce((a, b) => a + b, 0)).toBe(2);

    const mask = createEmptyMask(4, 1);
    mask.alpha[0] = 255;
    mask.alpha[1] = 127; // below the inclusion threshold
    const masked = lumaHistogram(doc, null, mask);
    expect(masked.reduce((a, b) => a + b, 0)).toBe(1);
  });
});
