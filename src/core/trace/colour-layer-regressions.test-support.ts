// Fixtures for colour-layer-regressions.test.ts (ADR-461 Amendment 2).
import type { ColoredPath } from '../scene';
import type { RawImageData } from './trace-image';
import { canvas, covers, fillRect } from './colour-layer-trace.test-support';

export function subpaths(paths: ReadonlyArray<ColoredPath>): number {
  return paths.reduce((sum, path) => sum + path.polylines.length, 0);
}

// Even-odd area of one path, sampled 4x4 per pixel.
export function sampledArea(path: ColoredPath, width: number, height: number): number {
  let inside = 0;
  for (let sy = 0; sy < height * 4; sy += 1) {
    for (let sx = 0; sx < width * 4; sx += 1) {
      if (covers(path, { x: (sx + 0.5) / 4 + 0.0013, y: (sy + 0.5) / 4 + 0.0017 })) inside += 1;
    }
  }
  return inside / 16;
}

export function checkerboardPatch(): RawImageData {
  const image = canvas(120, 120, [255, 255, 255]);
  fillRect(image, 4, 4, 20, 20, [0, 0, 0]);
  for (let y = 30; y < 90; y += 1) {
    for (let x = 30; x < 90; x += 1) {
      if ((x + y) % 2 === 0) fillRect(image, x, y, x + 1, y + 1, [0, 0, 0]);
    }
  }
  return image;
}

// Floyd-Steinberg dithered left-to-right grey ramp: a halftoned scan.
export function ditheredGradient(): RawImageData {
  const width = 128;
  const height = 64;
  const image = canvas(width, height, [255, 255, 255]);
  const error = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      error[y * width + x] = (255 * x) / (width - 1);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const old = error[i] as number;
      const value = old < 128 ? 0 : 255;
      fillRect(image, x, y, x + 1, y + 1, [value, value, value]);
      const e = old - value;
      if (x + 1 < width) error[i + 1] = (error[i + 1] as number) + (e * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) error[i + width - 1] = (error[i + width - 1] as number) + (e * 3) / 16;
        error[i + width] = (error[i + width] as number) + (e * 5) / 16;
        if (x + 1 < width) error[i + width + 1] = (error[i + width + 1] as number) + e / 16;
      }
    }
  }
  return image;
}

export type Coverage = (x: number, y: number) => number;

// Ink over a transparent canvas, alpha = 16x16 supersampled coverage x opacity.
// `tagged` stores the decoder's white-composited RGB with the original alpha.
export function inkOnTransparency(
  size: number,
  inside: Coverage,
  tagged: boolean,
  opacity = 1,
): RawImageData {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let hits = 0;
      for (let sy = 0; sy < 16; sy += 1) {
        for (let sx = 0; sx < 16; sx += 1) hits += inside(x + (sx + 0.5) / 16, y + (sy + 0.5) / 16);
      }
      const alpha = Math.round((255 * opacity * hits) / 256);
      const grey = tagged ? Math.round(255 * (1 - alpha / 255)) : 0;
      data.set([grey, grey, grey, alpha], (y * size + x) * 4);
    }
  }
  return tagged ? { width: size, height: size, data, rgbCompositedOnWhite: true } : { width: size, height: size, data };
}

export const disc =
  (r: number): Coverage =>
  (x, y) =>
    (x - 32) ** 2 + (y - 32) ** 2 <= r * r ? 1 : 0;
export const ring =
  (outer: number, inner: number): Coverage =>
  (x, y) => {
    const d2 = (x - 32) ** 2 + (y - 32) ** 2;
    return d2 <= outer * outer && d2 > inner * inner ? 1 : 0;
  };
