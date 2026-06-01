import { describe, expect, it } from 'vitest';

import { centerlineMaskFromImage, thinMask } from './centerline-mask';
import type { RawImageData } from './trace-image';

function image(width: number, height: number, black: ReadonlyArray<number>): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const idx of black) {
    const offset = idx * 4;
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

describe('centerlineMaskFromImage', () => {
  it('classifies dark non-transparent pixels as ink', () => {
    expect(Array.from(centerlineMaskFromImage(image(3, 1, [1])))).toEqual([0, 1, 0]);
  });
});

describe('thinMask', () => {
  it('thins a thick horizontal bar to one-pixel center candidates', () => {
    const input = new Uint8Array(7 * 5);
    for (let y = 1; y <= 3; y += 1) {
      for (let x = 1; x <= 5; x += 1) input[y * 7 + x] = 1;
    }

    const thinned = thinMask(input, 7, 5);
    const inkCount = thinned.reduce((sum, v) => sum + v, 0);

    expect(inkCount).toBeLessThan(input.reduce((sum, v) => sum + v, 0));
    expect(thinned[2 * 7 + 3]).toBe(1);
  });
});
