import { describe, expect, it } from 'vitest';
import type { Bounds, Polyline, Vec2 } from '../scene';
import { rasterizeVectorToLuma } from './rasterize-vector';

const INK = 127;
const WHITE = 255;

function rectangle(bounds: Bounds): Polyline {
  const { minX, minY, maxX, maxY } = bounds;
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}

describe('outline sampling at the half-pixel boundary', () => {
  it.each([
    [10, 10, 0, 0, 100, 100],
    [10.01, 10, 0, 0, 100, 100],
    [10, 10.01, 0, 0, 100, 100],
    [10.01, 7.03, 0, 0, 100, 70],
    [10.01, 7.03, 123.456, -78.91, 100, 70],
    [7.03, 10.01, -123.456, 78.91, 70, 100],
    [10.01, 7.03, 0, 0, 2048, 3],
  ])(
    'keeps the complete perimeter of %s x %s mm at (%s, %s) on a %s x %s grid',
    (widthMm, heightMm, minX, minY, pixelWidth, pixelHeight) => {
      const bounds = { minX, minY, maxX: minX + widthMm, maxY: minY + heightMm };
      const raster = rasterizeVectorToLuma({
        polylines: [rectangle(bounds)],
        bounds,
        renderType: 'outlines',
        pixelWidth,
        pixelHeight,
      });
      expect([raster.width, raster.height]).toEqual([pixelWidth, pixelHeight]);
      const expected = Uint8Array.from({ length: pixelWidth * pixelHeight }, (_, index) => {
        const x = index % pixelWidth;
        const y = Math.floor(index / pixelWidth);
        return x === 0 || y === 0 || x === pixelWidth - 1 || y === pixelHeight - 1 ? INK : WHITE;
      });
      expect(raster.luma).toEqual(expected);
    },
  );

  it.each([100, 1024, 65536])(
    'does not thicken an interior stroke beyond rounding error on a %s-pixel grid',
    (pixelWidth) => {
      // A vertical stroke at x=50 is tangent to pixel centre 49.5. Moving
      // it just 1e-7 pixel farther must leave that pixel white at every scale.
      for (const gap of [0, 1e-7]) {
        const x = pixelWidth / 2 + gap;
        const raster = rasterizeVectorToLuma({
          polylines: [
            {
              closed: false,
              points: [
                { x, y: 0 },
                { x, y: 1 },
              ],
            },
          ],
          bounds: { minX: 0, minY: 0, maxX: pixelWidth, maxY: 1 },
          pixelWidth,
          pixelHeight: 1,
          renderType: 'outlines',
        });
        expect(raster.luma[pixelWidth / 2 - 1]).toBe(gap === 0 ? INK : WHITE);
      }
    },
  );

  it.each(['identity', 'mirror', 'transpose'] as const)(
    'preserves diagonal tangency without admitting a genuinely outside pixel (%s)',
    (symmetry) => {
      const map = (p: Vec2): Vec2 => {
        if (symmetry === 'mirror') return { x: 21 - p.x, y: p.y };
        return symmetry === 'transpose' ? { x: p.y, y: p.x } : p;
      };
      for (const gap of [0, 1e-7]) {
        // Unit normal (3/5, 4/5), tangent (4/5, -3/5). The tested
        // pixel centre is exactly 0.5 pixel from the mathematical segment.
        const distance = 0.5 + gap;
        const foot = { x: 10.5 + distance * 0.6, y: 10.5 + distance * 0.8 };
        const raster = rasterizeVectorToLuma({
          polylines: [
            {
              closed: false,
              points: [
                map({ x: foot.x - 4, y: foot.y + 3 }),
                map({ x: foot.x + 4, y: foot.y - 3 }),
              ],
            },
          ],
          bounds: { minX: 0, minY: 0, maxX: 21, maxY: 21 },
          pixelWidth: 21,
          pixelHeight: 21,
          renderType: 'outlines',
        });
        expect(raster.luma[10 * 21 + 10]).toBe(gap === 0 ? INK : WHITE);
      }
    },
  );
});
