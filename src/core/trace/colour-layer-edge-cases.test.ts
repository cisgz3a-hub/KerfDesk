// Review follow-ups to ADR-461 Amendment 1: aliased hairlines at any angle,
// translucent halos hugging opaque ink, and the downsampled (> 4 MP) working
// grid keep the guarantees the amendment states.
import { describe, expect, it } from 'vitest';
import type { ColoredPath, Vec2 } from '../scene';
import type { RawImageData, TraceOptions } from './trace-image';
import { traceImageToColoredPaths } from './trace-to-paths';
import { resampleColourAppearance } from './colour-appearance';
import { canvas, covers, fillRect, lightness, OPTIONS } from './colour-layer-trace.test-support';

const withColours = (colours: number | undefined): TraceOptions =>
  colours === undefined
    ? OPTIONS
    : { ...OPTIONS, colourLayers: { ...OPTIONS.colourLayers, colours } };

function bresenham(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  const points: Vec2[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) return points;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

describe('colour-layer aliased hairlines at any angle', () => {
  it.each([
    ['~9 deg', 70, 20],
    ['~18 deg', 70, 30],
    ['~27 deg', 70, 40],
    ['~56 deg', 50, 70],
    ['~63 deg', 40, 70],
    ['~72 deg', 30, 70],
    ['~81 deg', 20, 70],
  ] as const)('keeps a 1-px %s line at the default speck area', async (_, x1, y1) => {
    const image = canvas(128, 128, [255, 255, 255]);
    fillRect(image, 90, 90, 110, 110, [255, 0, 0]);
    const line = bresenham(10, 10, x1, y1);
    for (const { x, y } of line) fillRect(image, x, y, x + 1, y + 1, [255, 0, 0]);
    for (const colours of [undefined, 2]) {
      const paths = await traceImageToColoredPaths(image, {
        ...withColours(colours),
        despeckleMinPixels: 12,
      });
      const red = paths.find((path) => path.color === '#ff0000');
      expect(red).toBeDefined();
      if (red === undefined) continue;
      const kept = line.filter(({ x, y }) => covers(red, { x: x + 0.5, y: y + 0.5 }));
      // Pixel labels all survive; the smoothed outline may still shave one
      // pixel centre near each tip, exactly as origin/main's does (59/61).
      expect(kept.length).toBeGreaterThanOrEqual(line.length - 2);
    }
  });
});

// Opaque black disc (r=15) inside a flat red ring at alpha 100, on transparency.
function haloImage(width: number, tagged: boolean): RawImageData {
  const size = 64;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const r = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
      const o = (y * size + x) * 4;
      if (r <= 15) data.set([0, 0, 0, 255], o);
      else if (r <= 15 + width) {
        // Tagged: the decoder's white-composited RGB for red at alpha 100.
        data.set(tagged ? [255, 155, 155, 100] : [255, 0, 0, 100], o);
      }
    }
  }
  return tagged
    ? { width: size, height: size, data, rgbCompositedOnWhite: true }
    : { width: size, height: size, data };
}

describe('colour-layer translucent halo around opaque ink', () => {
  for (const width of [2, 3, 6]) {
    for (const tagged of [false, true]) {
      it(`keeps a ${width}-px alpha-100 halo (tagged=${tagged})`, async () => {
        const inner: Vec2[] = [];
        for (let y = 0; y < 64; y += 1) {
          for (let x = 0; x < 64; x += 1) {
            const r = Math.hypot(x + 0.5 - 32, y + 0.5 - 32);
            if (r > 15.8 && r < 15 + width - 0.8) inner.push({ x: x + 0.5, y: y + 0.5 });
          }
        }
        expect(inner.length).toBeGreaterThan(0);
        for (const colours of [undefined, 3]) {
          const paths = await traceImageToColoredPaths(
            haloImage(width, tagged),
            withColours(colours),
          );
          const halo = paths.filter((path) => lightness(path.color) > 40);
          const kept = inner.filter((point) => halo.some((path) => covers(path, point)));
          expect(kept.length / inner.length).toBeGreaterThanOrEqual(0.9);
        }
      });
    }
  }
});

// Anti-aliased ring (outer 120, inner 110) on transparency, alpha from 8x8 coverage.
function bigRing(tagged: boolean): RawImageData {
  const size = 256;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < 8; sy += 1) {
        for (let sx = 0; sx < 8; sx += 1) {
          const d = Math.hypot(x + (sx + 0.5) / 8 - 128, y + (sy + 0.5) / 8 - 128);
          if (d <= 120 && d > 110) hits += 1;
        }
      }
      const alpha = Math.round((255 * hits) / 64);
      const grey = tagged ? 255 - alpha : 0;
      data.set([grey, grey, grey, alpha], (y * size + x) * 4);
    }
  }
  return tagged
    ? { width: size, height: size, data, rgbCompositedOnWhite: true }
    : { width: size, height: size, data };
}

// Even-odd area of nested outlines: the largest ring minus the holes inside it.
function nestedArea(path: ColoredPath): number {
  const rings = path.polylines
    .map(({ points }) => {
      let twice = 0;
      for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
        const a = points[i] as Vec2;
        const b = points[j] as Vec2;
        twice += (b.x - a.x) * (b.y + a.y);
      }
      return Math.abs(twice / 2);
    })
    .sort((a, b) => b - a);
  return rings.reduce((sum, area, i) => (i === 0 ? area : sum - area), 0);
}

describe('colour-layer downsampled working grid on transparency', () => {
  for (const tagged of [false, true]) {
    it(`keeps a resampled ring at its half-coverage edge (tagged=${tagged})`, async () => {
      // The > 4 MP path resamples with resampleColourAppearance at scale < 1.
      const scaled = 177;
      const working = resampleColourAppearance(bigRing(tagged), scaled, scaled);
      const scale = scaled / 256;
      const trueArea = Math.PI * (120 ** 2 - 110 ** 2) * scale * scale;
      for (const colours of [undefined, 2]) {
        const paths = await traceImageToColoredPaths(working, withColours(colours));
        expect(paths).toHaveLength(1);
        const area = nestedArea(paths[0] as ColoredPath);
        expect(Math.abs(area - trueArea) / trueArea).toBeLessThan(0.03);
      }
    });
  }
});
