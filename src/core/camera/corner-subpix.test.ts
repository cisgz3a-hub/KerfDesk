import { describe, expect, it } from 'vitest';
import { type GrayImage, refineCornerSubpixel } from './corner-subpix';

// An anti-aliased 4-quadrant checkerboard corner with its saddle at (cx, cy):
// each pixel's intensity is the white-area coverage of a corner whose two edges
// are the lines x=cx and y=cy. The +0.5 centers each 1px-wide edge ramp on the
// pixel sample grid, so the true corner sits exactly at (cx, cy) as the gradient
// field sees it — not snapped to, nor half a pixel off, the integer grid.
function checkerCornerImage(size: number, cx: number, cy: number): GrayImage {
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const data = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const leftFraction = clamp01(cx - x + 0.5);
      const topFraction = clamp01(cy - y + 0.5);
      const white = leftFraction * topFraction + (1 - leftFraction) * (1 - topFraction);
      data[y * size + x] = 255 * white;
    }
  }
  return { data, width: size, height: size };
}

describe('refineCornerSubpixel', () => {
  it('recovers a known sub-pixel corner from a nearby integer guess', () => {
    const image = checkerCornerImage(48, 24.3, 20.7);
    const refined = refineCornerSubpixel(image, { x: 25, y: 20 }, 6);
    expect(Math.hypot(refined.x - 24.3, refined.y - 20.7)).toBeLessThan(0.3);
  });

  it('pulls a one-pixel-off guess back onto the corner', () => {
    const image = checkerCornerImage(48, 30, 18);
    const refined = refineCornerSubpixel(image, { x: 31, y: 17 }, 6);
    expect(Math.hypot(refined.x - 30, refined.y - 18)).toBeLessThan(0.3);
  });

  it('leaves a featureless region unchanged (ill-conditioned)', () => {
    const flat: GrayImage = { data: new Float64Array(20 * 20).fill(100), width: 20, height: 20 };
    expect(refineCornerSubpixel(flat, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });
});
