// Unit tests for the 13-mode dither parity suite. Covers each mode's
// determinism, output-domain (binary), and dark-as-ink convention,
// plus a property check that error-diffusion modes preserve local
// average brightness (the whole reason halftoning works).

import { describe, expect, it } from 'vitest';

import { DITHER_MODES, type DitherMode, ditherForTrace } from './dither-trace';
import type { RawImageData } from './trace-image';

// Build a flat-grey W×H image at luma `v` (R=G=B=v).
function flatGrey(width: number, height: number, v: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p += 1) {
    const i = p * 4;
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

// Horizontal grey-ramp from 0 to 255 across `width` pixels, repeated for
// every row. Useful for testing that mid-tones produce mixed output.
function horizontalRamp(width: number, height: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round((x / Math.max(1, width - 1)) * 255);
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

// Fraction of pixels classified as "ink" (R channel === 0). Convention
// is dark = ink everywhere downstream, so 0 means black means burn.
function inkFraction(image: RawImageData): number {
  let ink = 0;
  const px = image.width * image.height;
  for (let p = 0; p < px; p += 1) {
    if (image.data[p * 4] === 0) ink += 1;
  }
  return ink / px;
}

const ERROR_DIFFUSION_MODES = [
  'floyd-steinberg',
  'jarvis',
  'stucki',
  'atkinson',
  'burkes',
  'sierra3',
  'sierra2',
  'sierra-lite',
] satisfies ReadonlyArray<DitherMode>;

const STRUCTURED_MODES = ['ordered', 'blue-noise'] satisfies ReadonlyArray<DitherMode>;

describe('DITHER_MODES', () => {
  it('lists exactly 13 modes', () => {
    expect(DITHER_MODES).toHaveLength(13);
  });

  it('has unique ids', () => {
    const ids = DITHER_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('ditherForTrace — none', () => {
  it('returns the input ref-equal when mode is none', () => {
    const input = flatGrey(4, 4, 100);
    expect(ditherForTrace(input, 'none')).toBe(input);
  });
});

describe('ditherForTrace — threshold', () => {
  it('produces dark ink below cutoff, white above', () => {
    const dark = flatGrey(2, 2, 50);
    const light = flatGrey(2, 2, 200);
    expect(inkFraction(ditherForTrace(dark, 'threshold', 128))).toBe(1);
    expect(inkFraction(ditherForTrace(light, 'threshold', 128))).toBe(0);
  });
});

describe('ditherForTrace — error diffusion modes', () => {
  for (const mode of ERROR_DIFFUSION_MODES) {
    describe(mode, () => {
      it('outputs only pure 0 or 255 per channel', () => {
        const out = ditherForTrace(horizontalRamp(32, 8), mode);
        for (let i = 0; i < out.data.length; i += 4) {
          const r = out.data[i];
          expect(r === 0 || r === 255).toBe(true);
          // R=G=B is the contract.
          expect(out.data[i + 1]).toBe(r);
          expect(out.data[i + 2]).toBe(r);
          // Alpha is always 255 (opaque).
          expect(out.data[i + 3]).toBe(255);
        }
      });

      it('preserves local average brightness on a 50% grey field (±15%)', () => {
        // Halftoning's whole point: a flat-grey input at 50% should
        // produce ~50% ink density.
        const out = ditherForTrace(flatGrey(64, 64, 128), mode);
        const frac = inkFraction(out);
        expect(frac).toBeGreaterThan(0.35);
        expect(frac).toBeLessThan(0.65);
      });

      it('is deterministic across runs', () => {
        const input = horizontalRamp(16, 16);
        const a = ditherForTrace(input, mode);
        const b = ditherForTrace(input, mode);
        expect(Array.from(a.data)).toEqual(Array.from(b.data));
      });
    });
  }
});

describe('ditherForTrace — structured modes', () => {
  for (const mode of STRUCTURED_MODES) {
    describe(mode, () => {
      it('is deterministic across runs', () => {
        const input = horizontalRamp(16, 16);
        const a = ditherForTrace(input, mode);
        const b = ditherForTrace(input, mode);
        expect(Array.from(a.data)).toEqual(Array.from(b.data));
      });

      it('produces mid-density on 50% grey', () => {
        const out = ditherForTrace(flatGrey(64, 64, 128), mode);
        const frac = inkFraction(out);
        expect(frac).toBeGreaterThan(0.3);
        expect(frac).toBeLessThan(0.7);
      });
    });
  }
});

describe('ditherForTrace — random', () => {
  it('is deterministic across runs (fixed LCG seed)', () => {
    const input = horizontalRamp(16, 16);
    const a = ditherForTrace(input, 'random');
    const b = ditherForTrace(input, 'random');
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('produces mid-density on 50% grey (±15%)', () => {
    const out = ditherForTrace(flatGrey(64, 64, 128), 'random');
    const frac = inkFraction(out);
    expect(frac).toBeGreaterThan(0.35);
    expect(frac).toBeLessThan(0.65);
  });
});

describe('ditherForTrace — output shape contract', () => {
  it('preserves width and height', () => {
    const input = horizontalRamp(13, 7);
    const out = ditherForTrace(input, 'floyd-steinberg');
    expect(out.width).toBe(13);
    expect(out.height).toBe(7);
    expect(out.data.length).toBe(13 * 7 * 4);
  });

  it('does not mutate the input buffer', () => {
    const input = horizontalRamp(8, 8);
    const before = Array.from(input.data);
    ditherForTrace(input, 'floyd-steinberg');
    expect(Array.from(input.data)).toEqual(before);
  });
});
