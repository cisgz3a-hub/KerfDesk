import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { highPassInPlace } from './high-pass';

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? 0;
}

describe('highPassInPlace', () => {
  it('maps a flat image to mid-grey', () => {
    const doc = createRgbaBuffer(8, 8);
    highPassInPlace(doc, 2, null, null);
    expect(grey(doc, 0, 0)).toBe(128);
    expect(grey(doc, 4, 4)).toBe(128);
  });

  it('keeps detail near an edge and grey far from it', () => {
    const doc = createRgbaBuffer(16, 3);
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const base = (y * 16 + x) * 4;
        doc.data[base] = 0;
        doc.data[base + 1] = 0;
        doc.data[base + 2] = 0;
      }
    }
    highPassInPlace(doc, 1, null, null);
    // Dark side of the edge dips below grey, light side rises above.
    expect(grey(doc, 7, 1)).toBeLessThan(128);
    expect(grey(doc, 8, 1)).toBeGreaterThan(128);
    // Far from the edge everything settles to mid-grey.
    expect(grey(doc, 0, 1)).toBe(128);
    expect(grey(doc, 15, 1)).toBe(128);
  });
});
