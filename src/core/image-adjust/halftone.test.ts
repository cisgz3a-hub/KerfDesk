import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { halftoneScreenInPlace, type HalftoneParams } from './halftone';

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
    // At 3/8 ink the line is exactly three whole rows of every 8.
    const doc = createRgbaBuffer(32, 32);
    fill(doc, 159);
    halftoneScreenInPlace(doc, { spacingPx: 8, angleDeg: 0, shape: 'line' }, null, null);
    for (let y = 0; y < 32; y += 1) {
      const first = doc.data[y * 32 * 4] ?? 0;
      for (let x = 1; x < 32; x += 1) {
        expect(doc.data[(y * 32 + x) * 4]).toBe(first);
      }
    }
    expect(blackRatio(doc)).toBe(3 / 8);
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

// Quality audit Q3-P2-1: a screen's covered area follows ink (1 - luma/255).
// Along the pixel grid (0° and 90°) a screen is a threshold array of s² + 1
// tones, so on whole cells coverage lands within 1/(2s²) of ink, at every
// level and in order. Off the axes the sampled spot tracks ink within 1.2%
// on a 128 px patch (worst measured over every level: 1.17%, 4 px lines at
// 45°); those cases check every fifth level to keep the run short.
describe('halftone tone tracking', () => {
  const AXIS_PATCH = 32; // whole cells at 4, 8 and 16 px
  const OFF_AXIS_PATCH = 128;
  const OFF_AXIS_TOLERANCE = 0.012;
  const CASES = (['line', 'dot'] as const).flatMap((shape) =>
    [4, 8, 16].flatMap((spacingPx) =>
      [0, 15, 45, 90].map((angleDeg) => [shape, spacingPx, angleDeg] as const),
    ),
  );

  function screened(luma: number, size: number, params: HalftoneParams) {
    const doc = createRgbaBuffer(size, size);
    fill(doc, luma);
    halftoneScreenInPlace(doc, params, null, null);
    return doc;
  }

  it.each(CASES)('%s screen, %i px at %i°, tracks ink', (shape, s, angleDeg) => {
    const params = { spacingPx: s, angleDeg, shape };
    const axis = angleDeg % 90 === 0;
    const lumas = Array.from({ length: 256 }, (_, luma) => luma).filter(
      (luma) => axis || luma % 5 === 0,
    );
    const covered = lumas.map((luma) =>
      blackRatio(screened(luma, axis ? AXIS_PATCH : OFF_AXIS_PATCH, params)),
    );
    const errors = covered.map((value, i) => Math.abs(value - (1 - (lumas[i] ?? 0) / 255)));
    expect(Math.max(...errors)).toBeLessThanOrEqual(
      (axis ? 1 / (2 * s * s) : OFF_AXIS_TOLERANCE) + 1e-12,
    );
    // Solid black is solid; white stays white.
    expect(covered[0]).toBe(1);
    expect(covered.at(-1)).toBe(0);
    if (!axis) return;
    expect(new Set(covered).size).toBe(Math.min(s * s + 1, 256));
    covered.forEach((value, i) => expect(value).toBeLessThanOrEqual(covered[i - 1] ?? 1));
  });

  it('an axis line thickens outward from its centre row', () => {
    // Rows of an 8 px line at 0° sit 0..4 rows from the centre row 0; a row
    // takes ink only once every row nearer the centre is solid.
    const size = AXIS_PATCH;
    for (let luma = 0; luma <= 255; luma += 1) {
      const doc = screened(luma, size, { spacingPx: 8, angleDeg: 0, shape: 'line' });
      const inked = Array.from({ length: 8 }, (_, row) => {
        let count = 0;
        for (let x = 0; x < size; x += 1) if (doc.data[(row * size + x) * 4] === 0) count += 1;
        return count;
      });
      const distance = (row: number) => Math.min(row, 8 - row);
      const reach = Math.max(-1, ...inked.map((count, row) => (count > 0 ? distance(row) : -1)));
      inked.forEach((count, row) => {
        if (distance(row) < reach) expect(count).toBe(size);
      });
    }
  });
});
