import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { resampleBuffer } from './resample';

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? 0;
}

describe('resampleBuffer', () => {
  it('same size returns an equal copy sharing no bytes', () => {
    const doc = createRgbaBuffer(6, 4);
    doc.data[0] = 7;
    const out = resampleBuffer(doc, 6, 4);
    expect(out.data[0]).toBe(7);
    out.data[0] = 99;
    expect(doc.data[0]).toBe(7);
  });

  it('uniform images stay uniform at any scale', () => {
    const doc = createRgbaBuffer(10, 10);
    for (const [w, h] of [
      [20, 20],
      [3, 3],
      [7, 13],
    ] as const) {
      const out = resampleBuffer(doc, w, h);
      expect(out.width).toBe(w);
      expect(out.height).toBe(h);
      expect(grey(out, 0, 0)).toBe(255);
      expect(grey(out, w - 1, h - 1)).toBe(255);
    }
  });

  it('upscaling a half-black image keeps both sides pure away from the seam', () => {
    const doc = createRgbaBuffer(8, 8);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const b = (y * 8 + x) * 4;
        doc.data[b] = 0;
        doc.data[b + 1] = 0;
        doc.data[b + 2] = 0;
      }
    }
    const out = resampleBuffer(doc, 16, 16);
    expect(grey(out, 1, 8)).toBe(0);
    expect(grey(out, 14, 8)).toBe(255);
  });

  it('heavy downscale box-averages instead of point-sampling', () => {
    // Alternating 1-px black/white columns: naive bilinear at 8× down picks
    // near-pure columns; the halving chain must land close to mid-grey.
    const doc = createRgbaBuffer(64, 8);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 64; x += 2) {
        const b = (y * 64 + x) * 4;
        doc.data[b] = 0;
        doc.data[b + 1] = 0;
        doc.data[b + 2] = 0;
      }
    }
    const out = resampleBuffer(doc, 8, 8);
    const centre = grey(out, 4, 4);
    expect(centre).toBeGreaterThan(96);
    expect(centre).toBeLessThan(160);
  });

  it('floors dimensions and clamps to at least 1 px', () => {
    const doc = createRgbaBuffer(5, 5);
    const out = resampleBuffer(doc, 0, 2.9);
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
  });
});
