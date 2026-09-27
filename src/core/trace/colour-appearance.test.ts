import { describe, expect, it } from 'vitest';
import { colourAppearance, resampleColourAppearance } from './colour-appearance';
import type { RawImageData } from './trace-image';

function fixture(): RawImageData {
  const width = 8;
  const height = 6;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data.set([x * 30, y * 40, 80, [1, 64, 127, 128, 192, 255][x % 6] as number], i);
    }
  }
  return { width, height, data };
}

// Independent byte-valued appearance, matching what an opaque PNG would store.
function flattened(source: RawImageData): RawImageData {
  const data = source.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (source.data[i + 3] as number) / 255;
    for (let c = 0; c < 3; c += 1) {
      data[i + c] = Math.round((source.data[i + c] as number) * alpha + 255 * (1 - alpha));
    }
    data[i + 3] = 255;
  }
  return { ...source, data };
}

describe('colour appearance before working-grid resampling', () => {
  it('averages visible bytes once at integer and fractional scales', () => {
    const source = fixture();
    const before = source.data.slice();
    const flat = flattened(source);
    const taggedData = flat.data.slice();
    for (let i = 3; i < taggedData.length; i += 4) taggedData[i] = source.data[i] as number;
    const tagged = { ...source, data: taggedData, rgbCompositedOnWhite: true };
    for (const [width, height] of [
      [4, 3],
      [5, 4],
    ] as const) {
      const rawResult = resampleColourAppearance(source, width, height);
      expect(rawResult).toEqual(resampleColourAppearance(tagged, width, height));
      expect(rawResult).toEqual(resampleColourAppearance(flat, width, height));
    }
    // Independently average one complete 2x2 cell, including unequal alpha.
    const expected = [0, 1, 2].map((channel) =>
      Math.round(
        [0, 1, 8, 9].reduce((sum, pixel) => sum + (flat.data[pixel * 4 + channel] as number), 0) /
          4,
      ),
    );
    expect(Array.from(resampleColourAppearance(source, 4, 3).data.slice(0, 4))).toEqual([
      ...expected,
      255,
    ]);
    expect(source.data).toEqual(before);
  });

  it('keeps void cells, voids under-half cells and ignores hidden RGB', () => {
    const data = new Uint8ClampedArray([
      255, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 128, 255, 255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0, 0,
      0, 128, 0, 255, 255, 0,
    ]);
    const source = { width: 4, height: 2, data };
    const result = resampleColourAppearance(source, 2, 1);
    // The right cell is half visible (ADR-461 Amendment 1 half coverage): it
    // is ink, coloured by its visible pixels only, not lightened by the void.
    expect(Array.from(result.data)).toEqual([0, 0, 0, 0, 127, 127, 127, 255]);
    const quarter = data.slice();
    quarter[27] = 0;
    expect(Array.from(resampleColourAppearance({ ...source, data: quarter }, 2, 1).data)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const hiddenChanged = data.slice();
    for (let i = 0; i < hiddenChanged.length; i += 4) {
      if (hiddenChanged[i + 3] === 0) hiddenChanged.set([3, 7, 11], i);
    }
    expect(resampleColourAppearance({ ...source, data: hiddenChanged }, 2, 1)).toEqual(result);
  });

  it('keeps native opaque buffers and normalizes partial alpha without mutation', () => {
    const source = fixture();
    const before = source.data.slice();
    expect(colourAppearance(source).data).toEqual(flattened(source).data);
    expect(source.data).toEqual(before);
    const opaque = flattened(source);
    expect(colourAppearance(opaque)).toBe(opaque);
  });
});
