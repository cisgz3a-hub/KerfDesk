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

function lumaImage(values: ReadonlyArray<number>): RawImageData {
  const data = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 255;
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return { width: values.length, height: 1, data };
}

describe('centerlineMaskFromImage', () => {
  it('classifies dark non-transparent pixels as ink', () => {
    expect(Array.from(centerlineMaskFromImage(image(3, 1, [1])))).toEqual([0, 1, 0]);
  });

  it('uses the caller threshold instead of a hardcoded midpoint', () => {
    expect(Array.from(centerlineMaskFromImage(lumaImage([160]), { thresholdLuma: 200 }))).toEqual([
      1,
    ]);
    expect(Array.from(centerlineMaskFromImage(lumaImage([160]), { thresholdLuma: 80 }))).toEqual([
      0,
    ]);
  });

  it('uses the caller cutoff and threshold as an inclusive brightness band', () => {
    expect(
      Array.from(
        centerlineMaskFromImage(lumaImage([20, 80, 140]), { cutoffLuma: 50, thresholdLuma: 100 }),
      ),
    ).toEqual([0, 1, 0]);
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
