import { describe, expect, it } from 'vitest';
import { autoMedianFilter, hasImpulseNoise, medianFilter } from './preprocess';
import { DEFAULT_TRACE_OPTIONS, preprocessForTrace, type RawImageData } from './trace-image';
import { compositeRgbOverWhitePreservingAlpha } from '../../ui/trace/image-loader';

const size = 64;
const paper = (): RawImageData => ({
  width: size,
  height: size,
  data: new Uint8ClampedArray(size * size * 4).fill(255),
});
function paint(image: RawImageData, x: number, y: number, value: number): void {
  const i = (y * size + x) * 4;
  image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
}
function cleaned(image: RawImageData, median: boolean | 'auto'): RawImageData {
  return preprocessForTrace(image, {
    ...DEFAULT_TRACE_OPTIONS,
    medianFilter: median,
    thresholdLuma: 128,
    despeckleMinPixels: 0,
  });
}

describe('automatic median preserves coherent features', () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'retains clean one-pixel turns, orientation %i',
    (orientation) => {
      const image = paper();
      for (let x = 8; x <= 50; x++) {
        let px = x;
        let py = x < 28 ? 16 : x - 12;
        if ((orientation & 4) !== 0) px = size - 1 - px;
        for (let turn = 0; turn < (orientation & 3); turn++) [px, py] = [size - 1 - py, px];
        paint(image, px, py, 0);
      }
      expect(hasImpulseNoise(image)).toBe(false);
      expect(cleaned(image, 'auto')).toEqual(cleaned(image, false));
    },
  );

  it('removes isolated salt and pepper while retaining thin ink and a thin white counter', () => {
    const image = paper();
    for (let x = 8; x < 56; x++) paint(image, x, 20, 0);
    for (let y = 36; y < 60; y++) for (let x = 36; x < 60; x++) paint(image, x, y, 0);
    for (let x = 40; x < 56; x++) paint(image, x, 50, 255);
    const expected = cleaned(image, false);
    for (let y = 3; y < 15; y += 4) for (let x = 3; x < 60; x += 4) paint(image, x, y, 0);
    for (const [x, y] of [
      [40, 40],
      [44, 40],
      [48, 40],
      [52, 40],
    ])
      paint(image, x!, y!, 255);
    // Isolated pairs are still impulses; three connected samples are the
    // smallest continuation accepted by automatic structural protection.
    for (const [x, y] of [
      [3, 28],
      [4, 28],
      [10, 28],
      [11, 29],
    ])
      paint(image, x!, y!, 0);
    expect(hasImpulseNoise(image)).toBe(true);
    expect(cleaned(image, 'auto')).toEqual(expected);
    expect(cleaned(image, true)).not.toEqual(expected);
  });

  it('does not convert transparent paper into visible ink during noise repair', () => {
    const image = paper();
    for (let i = 0; i < size * size; i++) {
      image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = 0;
      image.data[i * 4 + 3] = 0;
    }
    for (let y = 16; y < 48; y++)
      for (let x = 16; x < 48; x++) image.data[(y * size + x) * 4 + 3] = 255;
    for (let y = 20; y < 45; y += 4) for (let x = 20; x < 45; x += 4) paint(image, x, y, 255);
    // Forced median keeps its explicit, historical greyscale contract.
    expect(medianFilter(image).data[3]).toBe(255);
    const automatic = cleaned(compositeRgbOverWhitePreservingAlpha(image), 'auto');
    expect(automatic.data[0]).toBe(255);
    expect(automatic.data[(32 * size + 32) * 4]).toBe(0);
  });

  it.each([128, 255])(
    'leaves clean loader-normalized thin artwork and its alpha intact (%i)',
    (alpha) => {
      const image = paper();
      for (let i = 0; i < size * size; i++) image.data[i * 4 + 3] = 0;
      for (let x = 8; x < 56; x++) {
        paint(image, x, 20, 0);
        image.data[(20 * size + x) * 4 + 3] = alpha;
      }
      const source = compositeRgbOverWhitePreservingAlpha(image);
      expect(autoMedianFilter(source)).toBe(source);
      expect(cleaned(source, 'auto')).toEqual(cleaned(source, false));
    },
  );
});
