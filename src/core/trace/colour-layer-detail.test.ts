import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { traceImageToColoredPaths } from './trace-to-paths';
import { canvas, covers, fillRect, OPTIONS } from './colour-layer-trace.test-support';

const PRESERVE = { ...OPTIONS, despeckleMinPixels: 0, colourLayers: { colours: 2 } };

describe('colour-layer deliberate small features', () => {
  it.each([
    ['horizontal', 1, 0],
    ['vertical', 0, 1],
    ['diagonal', 1, 1],
    ['mirrored diagonal', -1, 1],
  ] as const)(
    'retains every %s hairline pixel with zero and normal speck removal',
    async (_, dx, dy) => {
      const image = canvas(128, 128, [255, 255, 255]);
      // Keep the palette independent of whether the hairline survives cleanup.
      fillRect(image, 90, 90, 110, 110, [255, 0, 0]);
      const samples: Vec2[] = [];
      for (let i = 0; i < 40; i += 1) {
        const x = (dx < 0 ? 60 : 16) + dx * i;
        const y = 16 + dy * i;
        fillRect(image, x, y, x + 1, y + 1, [255, 0, 0]);
        samples.push({ x: x + 0.5, y: y + 0.5 });
      }
      for (const despeckleMinPixels of [0, 12]) {
        const paths = await traceImageToColoredPaths(image, { ...PRESERVE, despeckleMinPixels });
        const red = paths.find((path) => path.color === '#ff0000');
        expect(red).toBeDefined();
        if (red === undefined) continue;
        expect(samples.filter((point) => covers(red, point))).toHaveLength(40);
      }
    },
  );

  it('preserves an isolated dot and a diagonal paper counter with cleanup disabled', async () => {
    const image = canvas(64, 64, [255, 255, 255]);
    fillRect(image, 20, 20, 50, 50, [255, 0, 0]);
    fillRect(image, 8, 8, 9, 9, [255, 0, 0]);
    for (let i = 0; i < 8; i += 1) fillRect(image, 28 + i, 28 + i, 29 + i, 29 + i, [255, 255, 255]);
    const [red] = await traceImageToColoredPaths(image, PRESERVE);
    expect(red?.color).toBe('#ff0000');
    if (red === undefined) return;
    expect(covers(red, { x: 8.5, y: 8.5 })).toBe(true);
    for (let i = 0; i < 8; i += 1) expect(covers(red, { x: 28.5 + i, y: 28.5 + i })).toBe(false);
  });

  it('keeps a requested one-pixel seam colour when cleanup is disabled', async () => {
    const image = canvas(60, 40, [255, 0, 0]);
    fillRect(image, 30, 0, 60, 40, [0, 0, 255]);
    fillRect(image, 29, 0, 30, 40, [128, 0, 128]);
    const paths = await traceImageToColoredPaths(image, {
      ...PRESERVE,
      colourLayers: { colours: 3 },
    });
    const seam = paths.find((path) => path.color === '#800080');
    expect(seam).toBeDefined();
    if (seam === undefined) return;
    for (let y = 0; y < 40; y += 1) {
      const point = { x: 29.5, y: y + 0.5 };
      expect(paths.filter((path) => covers(path, point))).toEqual([seam]);
    }
  });

  it('still removes an isolated speck when the area control is enabled', async () => {
    const image = canvas(64, 64, [255, 255, 255]);
    fillRect(image, 30, 30, 50, 50, [255, 0, 0]);
    fillRect(image, 8, 8, 9, 9, [255, 0, 0]);
    const [red] = await traceImageToColoredPaths(image, { ...PRESERVE, despeckleMinPixels: 12 });
    expect(red?.color).toBe('#ff0000');
    if (red === undefined) return;
    expect(covers(red, { x: 8.5, y: 8.5 })).toBe(false);
    expect(covers(red, { x: 35.5, y: 35.5 })).toBe(true);
  });

  // ADR-461 Amendment 1: a dithered area cleans up into solid colour, as
  // before 2026-09-27, instead of one outline per pixel.
  it.each([
    ['checkerboard', (x: number, y: number) => (x + y) % 2 === 0],
    ['Bayer gradient', (x: number, y: number) => (x - 10) / 10 > BAYER[(y % 4) * 4 + (x % 4)]!],
  ] as const)('traces a %s dither as a few solid shapes', async (_, inked) => {
    const image = canvas(180, 80, [255, 255, 255]);
    fillRect(image, 20, 70, 160, 76, [0, 0, 0]);
    for (let y = 10; y < 60; y += 1)
      for (let x = 10; x < 170; x += 1)
        if (inked(x, y)) fillRect(image, x, y, x + 1, y + 1, [30, 50, 200]);
    const paths = await traceImageToColoredPaths(image, OPTIONS);
    const outlines = paths.reduce((sum, path) => sum + path.polylines.length, 0);
    expect(outlines).toBeGreaterThan(0);
    expect(outlines).toBeLessThanOrEqual(3);
  });
});

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
