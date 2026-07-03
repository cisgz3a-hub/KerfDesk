// Tests for the auto-upscale preprocessor. Small thin-featured sources
// (strokes under ~3px) degrade every tracer, so we supersample them 2x
// before tracing and scale the traced vectors back down. See
// auto-upscale.ts for the WHY.
//
// Four units under test:
//   1. shouldAutoUpscale — the pure detector (size cap + thin-stroke proxy).
//   2. upscaleDouble — 2x bilinear upscale of the RGBA buffer.
//   3. downscaleTracedPaths — pure coordinate division.
//   4. Integration through traceImageToColoredPaths with a real preset.

import { describe, expect, it } from 'vitest';

import type { ColoredPath } from '../scene';
import { shouldAutoUpscale, upscaleDouble, downscaleTracedPaths } from './auto-upscale';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS, traceImageToColoredPaths } from './index';

// Build a white RGBA image and let a painter darken pixels to ink.
function whiteImage(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  return { width, height, data };
}

function setInk(image: RawImageData, x: number, y: number): void {
  const o = (y * image.width + x) * 4;
  image.data[o] = 0;
  image.data[o + 1] = 0;
  image.data[o + 2] = 0;
  image.data[o + 3] = 255;
}

// A long horizontal black bar `thickness` px tall, centred vertically.
function barImage(width: number, height: number, thickness: number): RawImageData {
  const image = whiteImage(width, height);
  const top = Math.floor((height - thickness) / 2);
  for (let y = top; y < top + thickness; y += 1) {
    for (let x = 0; x < width; x += 1) setInk(image, x, y);
  }
  return image;
}

describe('shouldAutoUpscale', () => {
  it('is true for a long thin (2px) stroke under the size cap', () => {
    // area/perimeter ~= w/2 ~= 1 for a 2px bar → below the 1.5 threshold.
    expect(shouldAutoUpscale(barImage(100, 60, 2))).toBe(true);
  });

  it('is false for a thick (8px) stroke — half-width proxy exceeds the threshold', () => {
    expect(shouldAutoUpscale(barImage(100, 60, 8))).toBe(false);
  });

  it('is false for an all-white image (no ink)', () => {
    expect(shouldAutoUpscale(whiteImage(100, 60))).toBe(false);
  });

  it('is false when the source exceeds the pixel cap even with a thin stroke', () => {
    // 1300x1300 = 1.69M px > 1.5M cap. Thin stroke would otherwise qualify.
    expect(shouldAutoUpscale(barImage(1300, 1300, 2))).toBe(false);
  });
});

describe('upscaleDouble', () => {
  it('doubles the dimensions', () => {
    const src = whiteImage(2, 2);
    const up = upscaleDouble(src);
    expect(up.width).toBe(4);
    expect(up.height).toBe(4);
    expect(up.data.length).toBe(4 * 4 * 4);
  });

  it('keeps corner pixel values and interpolates midpoints on a checkerboard', () => {
    // 2x2 checkerboard: (0,0) black, (1,0) white, (0,1) white, (1,1) black.
    const src = whiteImage(2, 2);
    setInk(src, 0, 0);
    setInk(src, 1, 1);
    const up = upscaleDouble(src);
    const red = (x: number, y: number): number => up.data[(y * up.width + x) * 4] ?? -1;
    // Output samples source at ((x+0.5)/2 - 0.5, ...) with edge clamping.
    // Top-left output pixel (0,0) clamps to source (0,0) = black.
    expect(red(0, 0)).toBe(0);
    // Bottom-right output pixel (3,3) clamps to source (1,1) = black.
    expect(red(3, 3)).toBe(0);
    // Top-right output pixel (3,0) clamps to source (1,0) = white.
    expect(red(3, 0)).toBe(255);
    // An interior pixel straddling the black/white boundary interpolates
    // to a grey value strictly between the two extremes.
    const mid = red(2, 1);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
  });
});

describe('downscaleTracedPaths', () => {
  it('halves every coordinate and preserves closed flags and colours', () => {
    const paths: ColoredPath[] = [
      {
        color: '#123456',
        polylines: [
          {
            points: [
              { x: 4, y: 8 },
              { x: 10, y: 20 },
            ],
            closed: true,
          },
          { points: [{ x: 2, y: 6 }], closed: false },
        ],
      },
    ];
    const out = downscaleTracedPaths(paths, 2);
    expect(out[0]?.color).toBe('#123456');
    expect(out[0]?.polylines[0]?.points).toEqual([
      { x: 2, y: 4 },
      { x: 5, y: 10 },
    ]);
    expect(out[0]?.polylines[0]?.closed).toBe(true);
    expect(out[0]?.polylines[1]?.closed).toBe(false);
  });
});

describe('traceImageToColoredPaths auto-upscale wiring', () => {
  // A 2px-wide letter-like glyph: a vertical stroke + a horizontal foot,
  // small enough that shouldAutoUpscale fires.
  function glyphImage(): RawImageData {
    const image = whiteImage(40, 40);
    for (let y = 8; y < 32; y += 1) {
      setInk(image, 12, y);
      setInk(image, 13, y);
    }
    for (let x = 12; x < 30; x += 1) {
      setInk(image, x, 30);
      setInk(image, x, 31);
    }
    return image;
  }

  function totalLength(paths: ReadonlyArray<ColoredPath>): number {
    let total = 0;
    for (const path of paths) {
      for (const pl of path.polylines) {
        for (let i = 0; i + 1 < pl.points.length; i += 1) {
          const a = pl.points[i];
          const b = pl.points[i + 1];
          if (a !== undefined && b !== undefined) total += Math.hypot(a.x - b.x, a.y - b.y);
        }
      }
    }
    return total;
  }

  function maxCoord(paths: ReadonlyArray<ColoredPath>): number {
    let max = 0;
    for (const path of paths) {
      for (const pl of path.polylines) {
        for (const p of pl.points) max = Math.max(max, p.x, p.y);
      }
    }
    return max;
  }

  it('returns output in SOURCE coordinates when upscaling (proves scale-back)', async () => {
    const image = glyphImage();
    const base = TRACE_PRESETS['Edge Detection'];
    if (base === undefined) throw new Error('Edge Detection preset missing');
    const withFlag = await traceImageToColoredPaths(image, {
      ...base,
      autoUpscaleSmallSources: true,
    });
    // Coordinates must fall inside the source frame, not the 2x buffer.
    expect(maxCoord(withFlag)).toBeLessThanOrEqual(Math.max(image.width, image.height));
  });

  it('does not lose geometry versus the un-upscaled run', async () => {
    const image = glyphImage();
    const base = TRACE_PRESETS['Edge Detection'];
    if (base === undefined) throw new Error('Edge Detection preset missing');
    const withFlag = await traceImageToColoredPaths(image, {
      ...base,
      autoUpscaleSmallSources: true,
    });
    const withoutFlag = await traceImageToColoredPaths(image, {
      ...base,
      autoUpscaleSmallSources: false,
    });
    // Upscaling must not meaningfully LOSE geometry — loose bound (hard
    // evidence comes from the perceptual battery, not this unit test). The 2%
    // tolerance absorbs sub-pixel noise from where ring-closing edges land at
    // the two scales; a real loss (dropped contour) is far larger.
    expect(totalLength(withFlag)).toBeGreaterThanOrEqual(totalLength(withoutFlag) * 0.98);
  });
});
