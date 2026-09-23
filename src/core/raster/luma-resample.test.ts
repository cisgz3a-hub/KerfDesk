import { describe, expect, it } from 'vitest';
import { burnGridKernel, createLumaRowResampler, resampleLuma } from './luma-resample';

// The nearest-neighbour formula every non-downscaled axis must still match.
function nearestOracle(luma: Uint8Array, sw: number, sh: number, w: number, h: number) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / h));
    for (let x = 0; x < w; x += 1) {
      const sx = Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / w));
      out[y * w + x] = luma[sy * sw + sx] ?? 255;
    }
  }
  return out;
}

function pattern(width: number, height: number): Uint8Array {
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i += 1) luma[i] = (i * 53 + 11) % 256;
  return luma;
}

describe('resampleLuma', () => {
  it('keeps a constant image constant at non-integer downscale ratios', () => {
    for (const [sw, sh, w, h] of [
      [37, 29, 20, 15],
      [4000, 3, 1500, 2],
      [37, 5, 20, 9], // downscales X, upscales Y
    ] as const) {
      for (const value of [0, 1, 128, 254, 255]) {
        const out = resampleLuma(
          { luma: new Uint8Array(sw * sh).fill(value), width: sw, height: sh },
          w,
          h,
        );
        expect(new Set(out), `${sw}x${sh}->${w}x${h} @${value}`).toEqual(new Set([value]));
      }
    }
  });

  it('weights each source pixel by the share of the cell it covers', () => {
    // 5 -> 2: cell 0 covers a, b and half of c; cell 1 covers half of c, d, e.
    const out = resampleLuma(
      { luma: Uint8Array.from([10, 20, 100, 200, 250]), width: 5, height: 1 },
      2,
      1,
    );
    expect(Array.from(out)).toEqual([
      Math.round((10 + 20 + 0.5 * 100) / 2.5),
      Math.round((0.5 * 100 + 200 + 250) / 2.5),
    ]);
  });

  it('keeps a sub-cell white line as proportional grey instead of dropping or widening it', () => {
    // A 1 px white line in 4 px cells of black is a quarter of its cell.
    const luma = new Uint8Array(8).fill(0);
    luma[5] = 255;
    expect(Array.from(resampleLuma({ luma, width: 8, height: 1 }, 2, 1))).toEqual([0, 64]);
  });

  it('is byte-identical to nearest-neighbour when no axis is downscaled', () => {
    for (const [sw, sh, w, h] of [
      [12, 9, 20, 15],
      [12, 9, 12, 9],
      [3, 7, 11, 7],
    ] as const) {
      const luma = pattern(sw, sh);
      expect(resampleLuma({ luma, width: sw, height: sh }, w, h)).toEqual(
        nearestOracle(luma, sw, sh, w, h),
      );
    }
  });

  it('keeps the centre sample for the nearest kernel even when downscaling', () => {
    const luma = pattern(37, 29);
    expect(resampleLuma({ luma, width: 37, height: 29 }, 20, 15, 'nearest')).toEqual(
      nearestOracle(luma, 37, 29, 20, 15),
    );
  });

  it('streams rows identical to the whole-image resample, clamping out-of-range rows', () => {
    const input = { luma: pattern(37, 29), width: 37, height: 29 };
    const whole = resampleLuma(input, 20, 15);
    const rowAt = createLumaRowResampler(input, 20, 15);
    for (let y = 0; y < 15; y += 1) {
      expect(rowAt(y)).toEqual(whole.subarray(y * 20, (y + 1) * 20));
    }
    expect(rowAt(-3)).toEqual(whole.subarray(0, 20));
    expect(rowAt(99)).toEqual(whole.subarray(14 * 20, 15 * 20));
  });

  it('returns white for an empty source', () => {
    expect(
      Array.from(resampleLuma({ luma: new Uint8Array(0), width: 0, height: 0 }, 3, 1)),
    ).toEqual([255, 255, 255]);
  });

  it('averages for tone-rendering dithers and keeps centre samples for Threshold', () => {
    expect(burnGridKernel('floyd-steinberg')).toBe('area');
    expect(burnGridKernel('grayscale')).toBe('area');
    expect(burnGridKernel('ordered')).toBe('area');
    expect(burnGridKernel('threshold')).toBe('nearest');
  });
});
