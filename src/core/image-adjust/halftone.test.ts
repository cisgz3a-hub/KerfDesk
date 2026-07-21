import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { halftoneScreenInPlace } from './halftone';

function fill(doc: ReturnType<typeof createRgbaBuffer>, value: number): void {
  for (let i = 0; i < doc.data.length; i += 4) {
    doc.data[i] = value;
    doc.data[i + 1] = value;
    doc.data[i + 2] = value;
  }
}

function blackRatio(doc: ReturnType<typeof createRgbaBuffer>): number {
  let black = 0;
  let total = 0;
  for (let i = 0; i < doc.data.length; i += 4) {
    total += 1;
    if ((doc.data[i] ?? 0) === 0) black += 1;
  }
  return black / total;
}

function isPureMono(doc: ReturnType<typeof createRgbaBuffer>): boolean {
  for (let i = 0; i < doc.data.length; i += 4) {
    const v = doc.data[i] ?? 0;
    if (v !== 0 && v !== 255) return false;
  }
  return true;
}

describe('halftoneScreenInPlace', () => {
  it('screens mid-grey into pure black/white at roughly half coverage', () => {
    const doc = createRgbaBuffer(64, 64);
    fill(doc, 128);
    halftoneScreenInPlace(doc, { spacingPx: 8, angleDeg: 45, shape: 'dot' }, null, null);
    expect(isPureMono(doc)).toBe(true);
    const ratio = blackRatio(doc);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });

  it('keeps white white and near-black nearly solid', () => {
    const white = createRgbaBuffer(32, 32);
    halftoneScreenInPlace(white, { spacingPx: 8, angleDeg: 45, shape: 'dot' }, null, null);
    expect(blackRatio(white)).toBe(0);

    const dark = createRgbaBuffer(32, 32);
    fill(dark, 10);
    halftoneScreenInPlace(dark, { spacingPx: 8, angleDeg: 45, shape: 'dot' }, null, null);
    expect(blackRatio(dark)).toBeGreaterThan(0.85);
  });

  it('line shape at 0 degrees produces horizontal bands', () => {
    const doc = createRgbaBuffer(32, 32);
    fill(doc, 128);
    halftoneScreenInPlace(doc, { spacingPx: 8, angleDeg: 0, shape: 'line' }, null, null);
    // Rows are uniformly black or uniformly white.
    for (let y = 0; y < 32; y += 1) {
      const first = doc.data[y * 32 * 4] ?? 0;
      for (let x = 1; x < 32; x += 1) {
        expect(doc.data[(y * 32 + x) * 4]).toBe(first);
      }
    }
    const ratio = blackRatio(doc);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });

  it('darker input grows the dots monotonically', () => {
    const light = createRgbaBuffer(48, 48);
    fill(light, 200);
    const dark = createRgbaBuffer(48, 48);
    fill(dark, 60);
    const params = { spacingPx: 8, angleDeg: 45, shape: 'dot' } as const;
    halftoneScreenInPlace(light, params, null, null);
    halftoneScreenInPlace(dark, params, null, null);
    expect(blackRatio(dark)).toBeGreaterThan(blackRatio(light));
  });
});
