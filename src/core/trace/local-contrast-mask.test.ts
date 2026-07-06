import { describe, expect, it } from 'vitest';
import { localContrastInkBitmap } from './local-contrast-mask';
import type { RawImageData } from './trace-image';

const WHITE = 255;

function greyImage(width: number, height: number, luma = WHITE): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = luma;
    data[i * 4 + 1] = luma;
    data[i * 4 + 2] = luma;
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function paint(image: RawImageData, x: number, y: number, luma: number): void {
  const o = (y * image.width + x) * 4;
  // Test fixture setup writes straight into the buffer it just created.
  (image.data as Uint8ClampedArray)[o] = luma;
  (image.data as Uint8ClampedArray)[o + 1] = luma;
  (image.data as Uint8ClampedArray)[o + 2] = luma;
}

function inkAt(bitmap: { width: number; data: Uint8Array }, x: number, y: number): number {
  return bitmap.data[y * bitmap.width + x] ?? 0;
}

describe('localContrastInkBitmap', () => {
  it('detects a faint stroke the global threshold would drop', () => {
    // Luma 200 on white paper: 200 >= 128, so a global cut-off misses it;
    // locally it is ~50 darker than its neighbourhood, far beyond delta.
    const image = greyImage(40, 40);
    for (let y = 10; y < 30; y += 1) {
      paint(image, 19, y, 200);
      paint(image, 20, y, 200);
    }
    const mask = localContrastInkBitmap(image, { radiusPx: 6, delta: 6 });
    expect(inkAt(mask, 19, 20)).toBe(1);
    expect(inkAt(mask, 20, 20)).toBe(1);
    // Paper away from the stroke stays paper.
    expect(inkAt(mask, 5, 20)).toBe(0);
  });

  it('keeps large solid interiors filled via the global backbone', () => {
    // Deep inside a 30x30 solid block the local mean equals the pixel, so the
    // local test reads ~0 difference — the global threshold must keep it ink.
    const image = greyImage(100, 100);
    for (let y = 30; y < 60; y += 1) {
      for (let x = 30; x < 60; x += 1) paint(image, x, y, 20);
    }
    const mask = localContrastInkBitmap(image, { radiusPx: 12, delta: 6 });
    expect(inkAt(mask, 45, 45)).toBe(1); // dead centre
    expect(inkAt(mask, 31, 31)).toBe(1); // corner
    expect(inkAt(mask, 20, 45)).toBe(0); // paper outside
  });

  it('preserves a small interior hole (letter counter)', () => {
    // A dark ring with a 4px white counter: no morphology means the hole must
    // survive even when the blur radius is far larger than the hole.
    const image = greyImage(60, 60);
    for (let y = 20; y < 40; y += 1) {
      for (let x = 20; x < 40; x += 1) {
        const inHole = x >= 28 && x < 32 && y >= 28 && y < 32;
        if (!inHole) paint(image, x, y, 30);
      }
    }
    const mask = localContrastInkBitmap(image, { radiusPx: 12, delta: 6 });
    expect(inkAt(mask, 29, 29)).toBe(0); // counter stays open
    expect(inkAt(mask, 30, 30)).toBe(0);
    expect(inkAt(mask, 24, 24)).toBe(1); // ring body is ink
  });

  it('returns an empty mask for blank paper', () => {
    const mask = localContrastInkBitmap(greyImage(32, 32), { radiusPx: 8, delta: 6 });
    expect(mask.data.every((v) => v === 0)).toBe(true);
  });

  it('treats fully transparent pixels as paper', () => {
    const image = greyImage(20, 20, 0); // all-black...
    for (let i = 0; i < 20 * 20; i += 1) {
      (image.data as Uint8ClampedArray)[i * 4 + 3] = 0; // ...but fully transparent
    }
    const mask = localContrastInkBitmap(image, { radiusPx: 4, delta: 6 });
    expect(mask.data.every((v) => v === 0)).toBe(true);
  });

  it('is deterministic across runs', () => {
    const image = greyImage(50, 50);
    for (let y = 5; y < 45; y += 3) {
      for (let x = 5; x < 45; x += 2) paint(image, x, y, ((x * 31 + y * 17) % 200) + 30);
    }
    const a = localContrastInkBitmap(image, { radiusPx: 7, delta: 5 });
    const b = localContrastInkBitmap(image, { radiusPx: 7, delta: 5 });
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });
});
