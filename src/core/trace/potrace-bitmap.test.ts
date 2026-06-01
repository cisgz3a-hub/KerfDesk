import { describe, expect, it } from 'vitest';

import {
  lightBurnTraceBitmapFromImage,
  lightBurnTraceBitmapToMonochrome,
  removeSmallInkRegions,
} from './potrace-bitmap';

function grayImage(width: number, values: ReadonlyArray<number>) {
  const data = new Uint8ClampedArray(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] ?? 255;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { width, height: values.length / width, data };
}

describe('lightBurnTraceBitmapFromImage', () => {
  it('uses LightBurn Cutoff/Threshold inclusive brightness range', () => {
    const bitmap = lightBurnTraceBitmapFromImage(grayImage(6, [0, 10, 64, 128, 129, 255]), {
      cutoffLuma: 10,
      thresholdLuma: 128,
      ignoreLessThanPixels: 0,
    });

    expect(Array.from(bitmap.data)).toEqual([0, 1, 1, 1, 0, 0]);
  });

  it('suppresses ink regions up to Potrace turdsize area', () => {
    const bitmap = {
      width: 5,
      height: 3,
      data: new Uint8Array([
        1,
        0,
        1,
        1,
        0, //
        0,
        0,
        0,
        0,
        0, //
        1,
        1,
        1,
        0,
        0,
      ]),
    };

    const cleaned = removeSmallInkRegions(bitmap, 2);

    expect(Array.from(cleaned.data)).toEqual([
      0,
      0,
      0,
      0,
      0, //
      0,
      0,
      0,
      0,
      0, //
      1,
      1,
      1,
      0,
      0,
    ]);
  });

  it('converts the cleaned bitmap back to monochrome trace pixels', () => {
    const result = lightBurnTraceBitmapToMonochrome(grayImage(3, [0, 64, 200]), {
      cutoffLuma: 10,
      thresholdLuma: 128,
      ignoreLessThanPixels: 0,
    });

    expect(Array.from(result.data)).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });
});
