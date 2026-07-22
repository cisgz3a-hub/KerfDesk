import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { healSpotInPlace } from './spot-heal';

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? -1;
}

function fill(doc: ReturnType<typeof createRgbaBuffer>, value: number): void {
  for (let i = 0; i < doc.data.length; i += 4) {
    doc.data[i] = value;
    doc.data[i + 1] = value;
    doc.data[i + 2] = value;
  }
}

describe('healSpotInPlace', () => {
  it('replaces a dark speck with the surrounding tone', () => {
    const doc = createRgbaBuffer(40, 40);
    fill(doc, 180);
    // A black blemish at the centre.
    for (let y = 18; y < 22; y += 1) {
      for (let x = 18; x < 22; x += 1) {
        const base = (y * 40 + x) * 4;
        doc.data[base] = 0;
        doc.data[base + 1] = 0;
        doc.data[base + 2] = 0;
      }
    }
    healSpotInPlace(doc, { x: 20, y: 20 }, 5);
    expect(grey(doc, 20, 20)).toBe(180); // speck gone, surround tone in
    expect(grey(doc, 5, 5)).toBe(180); // far field untouched
  });

  it('the annulus median resists a small outlier in the ring', () => {
    const doc = createRgbaBuffer(40, 40);
    fill(doc, 100);
    // One bright outlier pixel in the sampling ring must not win the median.
    const base = (20 * 40 + 28) * 4;
    doc.data[base] = 250;
    doc.data[base + 1] = 250;
    doc.data[base + 2] = 250;
    healSpotInPlace(doc, { x: 20, y: 20 }, 5);
    expect(grey(doc, 20, 20)).toBe(100);
  });

  it('does nothing when the whole ring falls outside the document', () => {
    const doc = createRgbaBuffer(4, 4);
    fill(doc, 50);
    healSpotInPlace(doc, { x: 2, y: 2 }, 200);
    expect(grey(doc, 2, 2)).toBe(50);
  });
});
