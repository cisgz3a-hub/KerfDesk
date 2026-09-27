import { describe, expect, it } from 'vitest';
import { otsuThreshold, pieceMask } from './piece-mask';
import type { PieceImage } from './piece-image';

function flat(
  width: number,
  height: number,
  colour: (x: number, y: number) => number[],
): PieceImage {
  const rgb = new Float32Array(width * height * 3);
  const visible = new Uint8Array(width * height).fill(1);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      colour(x, y).forEach((value, c) => {
        rgb[(y * width + x) * 3 + c] = value;
      });
    }
  }
  return { width, height, rgb, visible };
}

describe('otsuThreshold', () => {
  it('splits two levels halfway between them whatever their shares', () => {
    const feature = new Float32Array(1000).map((_, i) => (i < 900 ? 40 : 200));
    const threshold = otsuThreshold(feature, new Uint8Array(1000).fill(1));
    expect(threshold).toBeCloseTo(120, 0);
  });
});

describe('pieceMask', () => {
  const inside = (x: number, y: number) => x >= 8 && x < 16 && y >= 8 && y < 16;

  it('takes the side that stays off the picture edge, dark or bright', () => {
    for (const [bed, blank] of [
      [60, 200],
      [200, 60],
    ] as const) {
      const image = flat(24, 24, (x, y) =>
        inside(x, y) ? [blank, blank, blank] : [bed, bed, bed],
      );
      const mask = pieceMask(image, null);
      expect(mask.on[12 * 24 + 12]).toBe(1);
      expect(mask.on[2 * 24 + 2]).toBe(0);
    }
  });

  it('splits by colour at the reference point when brightness matches', () => {
    // Grey bed and blue blank of the same brightness.
    const image = flat(24, 24, (x, y) => (inside(x, y) ? [40, 90, 150] : [82, 82, 82]));
    const byColour = pieceMask(image, { x: 12, y: 12 });
    expect(byColour.on[12 * 24 + 12]).toBe(1);
    expect(byColour.on[2 * 24 + 2]).toBe(0);
    // From a point on the bed the same blank is found.
    const fromBed = pieceMask(image, { x: 2, y: 2 });
    expect(fromBed.on[12 * 24 + 12]).toBe(1);
    expect(fromBed.on[2 * 24 + 2]).toBe(0);
  });

  it('leaves pixels the camera did not see off', () => {
    const image = flat(24, 24, (x, y) => (inside(x, y) ? [200, 200, 200] : [60, 60, 60]));
    image.visible[12 * 24 + 12] = 0;
    expect(pieceMask(image, null).on[12 * 24 + 12]).toBe(0);
  });
});
