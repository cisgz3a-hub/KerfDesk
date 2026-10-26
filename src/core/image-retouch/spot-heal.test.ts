import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { healRepairFrom, healSpotInPlace } from './spot-heal';

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

describe('healSpotInPlace on straight-alpha layers (audit 23-P2-1)', () => {
  type Doc = ReturnType<typeof createRgbaBuffer>;

  function pixel(doc: Doc, x: number, y: number): number[] {
    const base = (y * doc.width + x) * 4;
    return [...doc.data.slice(base, base + 4)];
  }

  // Paint [x0, x1) × [y0, y1) with one straight-alpha RGBA value.
  function paintRect(doc: Doc, x0: number, y0: number, x1: number, y1: number, rgba: number[]) {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) doc.data.set(rgba, (y * doc.width + x) * 4);
    }
  }

  it('heals cleaned-up paper to its own faint alpha, not to an opaque black disc', () => {
    const doc = createRgbaBuffer(40, 40);
    // "Clean up white paper" output: paper is black at alpha 24, a speck at 210.
    paintRect(doc, 0, 0, 40, 40, [0, 0, 0, 24]);
    paintRect(doc, 18, 18, 22, 22, [0, 0, 0, 210]);
    healSpotInPlace(doc, { x: 20, y: 20 }, 5);
    expect(pixel(doc, 20, 20)).toEqual([0, 0, 0, 24]);
    expect(pixel(doc, 22, 20)).toEqual([0, 0, 0, 24]);
  });

  it('heals a speck on an empty layer to transparency', () => {
    const doc = createRgbaBuffer(40, 40);
    doc.data.fill(0);
    paintRect(doc, 20, 20, 21, 21, [40, 40, 40, 255]);
    healSpotInPlace(doc, { x: 20, y: 20 }, 5);
    expect(pixel(doc, 20, 20)).toEqual([0, 0, 0, 0]);
  });

  it('takes the colour from the ring pixels that have coverage', () => {
    const doc = createRgbaBuffer(40, 40);
    // Most of the ring is transparent black; the rest is opaque grey 180.
    paintRect(doc, 0, 0, 24, 40, [0, 0, 0, 0]);
    paintRect(doc, 24, 0, 40, 40, [180, 180, 180, 255]);
    const repair = healRepairFrom(doc, { x: 20, y: 20 }, 5);
    expect(repair?.rgb).toEqual([180, 180, 180]);
    // Under half the ring has coverage, so the median alpha stays transparent.
    expect(repair?.alpha).toBe(0);
  });
});
