// Work per trace after the tracer speed round (2026-11-05, "Speed round,
// quality locked"): counts of the costly operations, not wall-clock, so a
// change that brings back repeated work fails here on any machine. The traced
// paths themselves are held byte-identical by the round's bench (Q4/Q5 sets,
// full-size assets, benchmark pages) and, for the whole-grid array passes,
// by the readers they replace (below).

import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePngFile } from '../../__fixtures__/perceptual/png-decode';
import type * as CornerField from './contour-corner-field';
import type * as TextDirection from './small-mark-text-direction';
import { withoutFieldPlanes } from './crack-field-planes';
import type { RawImageData } from './trace-image';
import { TRACE_PRESETS } from './trace-presets';
import { traceImageToColoredPaths } from './trace-to-paths';

const work = { wedgeFits: 0, letterReaches: 0 };

vi.mock('./contour-corner-field', async (importOriginal) => {
  const real = await importOriginal<typeof CornerField>();
  return {
    ...real,
    wedgeFieldFit: (...args: Parameters<typeof CornerField.wedgeFieldFit>) => {
      work.wedgeFits += 1;
      return real.wedgeFieldFit(...args);
    },
  };
});

vi.mock('./small-mark-text-direction', async (importOriginal) => {
  const real = await importOriginal<typeof TextDirection>();
  return {
    ...real,
    createTextDirections: (...args: Parameters<typeof TextDirection.createTextDirections>) => {
      const directions = real.createTextDirections(...args);
      return {
        ...directions,
        letterWithin: (...within: Parameters<typeof directions.letterWithin>) => {
          work.letterReaches += 1;
          return directions.letterWithin(...within);
        },
      };
    },
  };
});

beforeEach(() => {
  work.wedgeFits = 0;
  work.letterReaches = 0;
});
afterEach(() => vi.restoreAllMocks());

const ASSETS = resolve('src/__fixtures__/perceptual/assets');

function crop(image: RawImageData, x: number, y: number, w: number, h: number): RawImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + w * 4), row * w * 4);
  }
  return { width: w, height: h, data };
}

// The colour logo's lettering: Line Art takes the automatic-detail (sketch
// window) lane on it and enlarges it 2x.
const logoText = (): RawImageData =>
  crop(decodePngFile(`${ASSETS}/arch-house-langebaan-source.png`), 100, 540, 256, 200);

// Mid-grey letters' strokes and dots on a pale page, sprinkled with specks:
// many small marks near letters for the small-mark judge, and two-level art
// the clean-art check rewrites as its twin.
function speckledPage(inkLevel = 70, paperLevel = 235): RawImageData {
  const width = 240;
  const height = 160;
  const data = new Uint8ClampedArray(width * height * 4).fill(paperLevel);
  const ink = (x: number, y: number): void => {
    data.fill(inkLevel, (y * width + x) * 4, (y * width + x) * 4 + 3);
  };
  for (let letter = 0; letter < 9; letter += 1) {
    const left = 12 + letter * 25;
    for (let y = 40; y < 70; y += 1) for (let x = left; x < left + 4; x += 1) ink(x, y);
    for (let y = 66; y < 70; y += 1) for (let x = left; x < left + 14; x += 1) ink(x, y);
    // A colon after every third letter, a stop after the others.
    const dot = (top: number): void => {
      for (let y = top; y < top + 3; y += 1)
        for (let x = left + 18; x < left + 21; x += 1) ink(x, y);
    };
    dot(67);
    if (letter % 3 === 2) dot(55);
  }
  let state = 99;
  for (let k = 0; k < 400; k += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const x = state % width;
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    ink(x, 30 + (state % 50));
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width, height, data };
}

// Whole traces of ordinary inputs: generous time on a loaded runner.
vi.setConfig({ testTimeout: 60_000 });

describe('tracer work per trace (speed round)', () => {
  it("judges each colon partner's baseline once, not once per speck in reach", async () => {
    await traceImageToColoredPaths(speckledPage(), TRACE_PRESETS['Line Art']!);
    expect(work.letterReaches).toBeGreaterThan(0);
    expect(work.letterReaches).toBeLessThanOrEqual(LETTER_REACHES);
  });

  it('checks the field round a measured apex only for a corner that could win', async () => {
    await traceImageToColoredPaths(logoText(), TRACE_PRESETS['Line Art']!);
    expect(work.wedgeFits).toBeGreaterThan(0);
    expect(work.wedgeFits).toBeLessThanOrEqual(WEDGE_FITS);
  });
});

describe('whole-grid passes over a field read what its readers return', () => {
  it.each([
    ['Line Art', logoText],
    ['Smooth', logoText],
    ['Sharp', speckledPage],
    ['Line Art', speckledPage],
  ] as const)(
    '%s traces the same paths either way',
    async (preset, source) => {
      const image = source();
      const options = TRACE_PRESETS[preset]!;
      const direct = await traceImageToColoredPaths(image, options);
      const read = await withoutFieldPlanes(() => traceImageToColoredPaths(image, options));
      expect(direct.length).toBeGreaterThan(0);
      expect(direct).toEqual(read);
    },
    60_000,
  );
});

// Measured on this round's code (origin/main 790b95c4a made 5,918 and 127).
const LETTER_REACHES = 1672;
const WEDGE_FITS = 121;
