import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../rgba-image';
import { pieceMask, quantile } from './piece-mask';

const SIZE = 48;
const PPM = 2;

function picture(colour: (x: number, y: number) => readonly number[]): RgbaImage {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const c = colour(x, y);
      data.set([c[0] ?? 0, c[1] ?? 0, c[2] ?? 0, 255], (y * SIZE + x) * 4);
    }
  }
  return { data, width: SIZE, height: SIZE };
}

const inside = (x: number, y: number) => x >= 16 && x < 32 && y >= 16 && y < 32;
const at = (x: number, y: number) => y * SIZE + x;

describe('quantile', () => {
  it('reads the nearest rank', () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe('pieceMask', () => {
  it('takes what differs from the bed around the picture’s edge, dark or bright', () => {
    for (const [bed, blank] of [
      [60, 200],
      [200, 60],
    ] as const) {
      const mask = pieceMask(
        picture((x, y) => (inside(x, y) ? [blank, blank, blank] : [bed, bed, bed])),
        PPM,
        null,
      );
      expect(mask.on[at(24, 24)]).toBe(1);
      expect(mask.on[at(4, 4)]).toBe(0);
    }
  });

  it('splits by colour when brightness matches, from the bed or from the blank', () => {
    // Grey bed and blue blank of the same brightness.
    const image = picture((x, y) => (inside(x, y) ? [40, 90, 150] : [82, 82, 82]));
    for (const reference of [
      { x: 24, y: 24 },
      { x: 4, y: 4 },
    ]) {
      const mask = pieceMask(image, PPM, reference);
      expect(mask.on[at(24, 24)]).toBe(1);
      expect(mask.on[at(4, 4)]).toBe(0);
    }
  });

  it('counts a mark darker than the bed as bed beside brighter blanks', () => {
    // A bright blank, and a dark scorch mark as large as it.
    const image = picture((x, y) => {
      if (inside(x, y)) return [208, 178, 132];
      if (x >= 2 && x < 14 && y >= 34 && y < 46) return [42, 30, 24];
      return [178, 146, 108];
    });
    const mask = pieceMask(image, PPM, null);
    expect(mask.on[at(24, 24)]).toBe(1);
    expect(mask.on[at(8, 40)]).toBe(0);
  });

  it('finds nothing on an empty bed', () => {
    const mask = pieceMask(
      picture(() => [120, 120, 122]),
      PPM,
      null,
    );
    expect(mask.on.every((value) => value === 0)).toBe(true);
    expect(mask.pieceColour).toBeNull();
  });

  it('leaves pixels the camera did not see off', () => {
    const image = picture((x, y) => (inside(x, y) ? [200, 200, 200] : [60, 60, 60]));
    image.data[at(24, 24) * 4 + 3] = 0;
    expect(pieceMask(image, PPM, null).on[at(24, 24)]).toBe(0);
  });
});
