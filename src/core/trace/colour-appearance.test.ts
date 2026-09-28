import { describe, expect, it } from 'vitest';
import { colourAppearance, resampleColourAppearance, VISIBLE_ALPHA_MIN } from './colour-appearance';
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

// The same appearance with near-invisible pixels (under a quarter opacity)
// left void, hidden RGB untouched (ADR-461 Amendment 1).
function visible(source: RawImageData): RawImageData {
  const flat = flattened(source);
  const data = flat.data.slice();
  for (let i = 0; i < data.length; i += 4) {
    const alpha = source.data[i + 3] as number;
    if (alpha >= VISIBLE_ALPHA_MIN) continue;
    data.set(
      [source.data[i] as number, source.data[i + 1] as number, source.data[i + 2] as number, 0],
      i,
    );
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
    const seen = visible(source);
    for (const [width, height] of [
      [4, 3],
      [5, 4],
    ] as const) {
      const rawResult = resampleColourAppearance(source, width, height);
      expect(rawResult).toEqual(resampleColourAppearance(tagged, width, height));
      expect(rawResult).toEqual(resampleColourAppearance(seen, width, height));
    }
    // Independently average one complete 2x2 cell, including unequal alpha.
    // Pixels 0 and 8 (alpha 1) are void; only visible pixels colour the cell.
    const appearance = (pixel: number, channel: number): number =>
      (source.data[pixel * 4 + 3] as number) < VISIBLE_ALPHA_MIN
        ? 255
        : (flat.data[pixel * 4 + channel] as number);
    const expected = [0, 1, 2].map((channel) =>
      Math.round([1, 9].reduce((sum, pixel) => sum + appearance(pixel, channel), 0) / 2),
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
    expect(colourAppearance(source).data).toEqual(visible(source).data);
    expect(source.data).toEqual(before);
    const opaque = flattened(source);
    expect(colourAppearance(opaque)).toBe(opaque);
  });

  it('leaves pixels under a quarter opacity void, at native size and when resampled', () => {
    // A black soft shadow: alpha 63 is still void, alpha 64 is traced.
    const data = new Uint8ClampedArray([0, 0, 0, 63, 0, 0, 0, 1, 0, 0, 0, 64, 0, 0, 0, 255]);
    const source = { width: 2, height: 2, data };
    expect(Array.from(colourAppearance(source).data)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 191, 191, 191, 255, 0, 0, 0, 255,
    ]);
    const shadow = { width: 2, height: 1, data: data.slice(0, 8) };
    expect(Array.from(resampleColourAppearance(shadow, 1, 1).data)).toEqual([0, 0, 0, 0]);
  });
});
