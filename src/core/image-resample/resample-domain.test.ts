import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { resampleBuffer } from './resample';

describe('resampling the complete source domain', () => {
  it('weights the entire final row and column of an odd image', () => {
    const source = createRgbaBuffer(5, 5);
    for (let i = 0; i < 5; i += 1) {
      for (const pixel of [i * 5 + 4, 4 * 5 + i]) source.data.set([0, 0, 0, 255], pixel * 4);
    }
    const result = resampleBuffer(source, 2, 2);
    expect([...result.data]).toEqual([
      255, 255, 255, 255, 153, 153, 153, 255, 153, 153, 153, 255, 92, 92, 92, 255,
    ]);
  });

  it('area-filters a downscaled axis even when the other axis is unchanged', () => {
    const source = createRgbaBuffer(5, 1);
    source.data.set([0, 0, 0, 255], 16);
    expect([...resampleBuffer(source, 2, 1).data]).toEqual([
      255, 255, 255, 255, 153, 153, 153, 255,
    ]);
  });

  it('filters premultiplied color so hidden RGB cannot darken transparent edges', () => {
    const source = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]),
    };
    expect([...resampleBuffer(source, 1, 1).data]).toEqual([255, 0, 0, 128]);
    expect([...resampleBuffer(source, 3, 1).data].slice(4, 8)).toEqual([255, 0, 0, 128]);
  });
});
