// The row-at-a-time resampler keeps every byte of the per-pixel bilinear rule
// it replaced (tracer speed round): the same lerps of the same bytes.

import { describe, expect, it } from 'vitest';
import { upscaleBy, upscaleToWorkingGrid } from './auto-upscale';
import type { RawImageData } from './trace-image';

function noise(width: number, height: number, seed: number): RawImageData {
  let state = seed;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = state >>> 24;
  }
  return { width, height, data };
}

const clampCoord = (value: number, size: number): number =>
  value < 0 ? 0 : value >= size ? size - 1 : value;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// The per-pixel rule as auto-upscale.ts wrote it before the speed round: each
// output pixel samples the source at (o + 0.5) / factor - 0.5 (or, on a
// rounded grid, (o + 0.5) * size / outSize - 0.5), edges clamped.
function reference(image: RawImageData, width: number, height: number, factor: number | null) {
  const at = (o: number, size: number, outSize: number): number =>
    factor === null ? (o + 0.5) * (size / outSize) - 0.5 : (o + 0.5) / factor - 0.5;
  const data = new Uint8ClampedArray(width * height * 4);
  const src = image.data;
  for (let oy = 0; oy < height; oy += 1) {
    const sy = at(oy, image.height, height);
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    const row0 = clampCoord(y0, image.height) * image.width * 4;
    const row1 = clampCoord(y0 + 1, image.height) * image.width * 4;
    for (let ox = 0; ox < width; ox += 1) {
      const sx = at(ox, image.width, width);
      const x0 = Math.floor(sx);
      const fx = sx - x0;
      const l = clampCoord(x0, image.width) * 4;
      const r = clampCoord(x0 + 1, image.width) * 4;
      for (let c = 0; c < 4; c += 1) {
        const top = lerp(src[row0 + l + c] as number, src[row0 + r + c] as number, fx);
        const bottom = lerp(src[row1 + l + c] as number, src[row1 + r + c] as number, fx);
        data[(oy * width + ox) * 4 + c] = Math.round(lerp(top, bottom, fy));
      }
    }
  }
  return data;
}

describe('bilinear enlargement, a source row at a time', () => {
  it.each([
    [1, 1, 2],
    [7, 3, 2],
    [33, 20, 2],
    [17, 29, 3],
  ])('keeps every byte of a %ix%i source at %ix', (width, height, factor) => {
    const image = noise(width, height, width * 31 + height);
    const enlarged = upscaleBy(image, factor);
    expect(enlarged.data).toEqual(reference(image, width * factor, height * factor, factor));
  });

  it.each([
    [40, 25, 1.5],
    [31, 47, 1.37],
    [5, 64, 1.91],
  ])('keeps every byte of a %ix%i source on a %fx working grid', (width, height, factor) => {
    const image = noise(width, height, width + height * 17);
    const working = upscaleToWorkingGrid(image, factor);
    expect(working.data).toEqual(reference(image, working.width, working.height, null));
  });
});
