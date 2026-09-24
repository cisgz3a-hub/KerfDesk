import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { dither, type ErrorDiffusionMode } from './dither';
import { createErrorDiffusionRowDitherer } from './dither-rows';

const ALL_MODES: ReadonlyArray<ErrorDiffusionMode> = [
  'floyd-steinberg',
  'jarvis',
  'stucki',
  'atkinson',
  'burkes',
  'sierra3',
  'sierra2',
  'sierra-lite',
];

const S_MAX = 1000;

function lumaRowAtFor(luma: Uint8Array, width: number): (y: number) => Uint8Array {
  return (y) => luma.subarray(y * width, (y + 1) * width);
}

function materialized(luma: Uint8Array, width: number, height: number, mode: ErrorDiffusionMode) {
  return dither({ luma, width, height }, { algorithm: mode, sMax: S_MAX });
}

function collectRows(
  rowAt: (y: number) => Float64Array,
  width: number,
  height: number,
  order: ReadonlyArray<number>,
): Float64Array {
  const out = new Float64Array(width * height);
  for (const y of order) out.set(rowAt(y), y * width);
  return out;
}

describe('createErrorDiffusionRowDitherer', () => {
  it.each([
    { pixel: 'black', luma: [64, 0, 120], expected: [1000, 1000, 0] },
    { pixel: 'white', luma: [192, 255, 140], expected: [0, 0, 1000] },
  ])('carries nonzero error through an exact $pixel source pixel', ({ luma, expected }) => {
    const rowAt = createErrorDiffusionRowDitherer({
      width: 3,
      height: 1,
      algorithm: 'floyd-steinberg',
      sMax: S_MAX,
      lumaRowAt: () => Uint8Array.from(luma),
    });
    // Two 7/16 propagation steps put the last pixel at 132.25 or
    // 127.94140625. Dropping the middle binary pixel's incoming error
    // leaves it at 120 or 140, on the opposite side of the 128 cutoff.
    expect(rowAt(0)).toEqual(new Float64Array(expected));
  });

  it.each(ALL_MODES)('preserves binary margins and incoming gray-pixel error for %s', (mode) => {
    const width = 17;
    const height = 9;
    const luma = Uint8Array.from({ length: width * height }, (_, i) =>
      i % width < width / 2 ? 0 : 255,
    );
    // Exact binary rows have zero error; later gray pixels diffuse across
    // both scan directions into those same black/white source values.
    luma[width * 3 + 7] = 64;
    luma[width * 4 + 9] = 192;
    const reference = materialized(luma, width, height, mode);
    const rowAt = createErrorDiffusionRowDitherer({
      width,
      height,
      algorithm: mode,
      sMax: S_MAX,
      lumaRowAt: lumaRowAtFor(luma, width),
    });
    const order = Array.from({ length: height }, (_, y) => y);
    expect(collectRows(rowAt, width, height, order)).toEqual(reference);
    expect(collectRows(rowAt, width, height, order.reverse())).toEqual(reference);
  });

  it('reproduces dither() bit-for-bit across every kernel (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 1, max: 24 }),
        fc.constantFrom(...ALL_MODES),
        fc.infiniteStream(fc.integer({ min: 0, max: 255 })),
        (width, height, mode, bytes) => {
          const luma = new Uint8Array(width * height);
          const iterator = bytes[Symbol.iterator]();
          for (let i = 0; i < luma.length; i += 1) luma[i] = iterator.next().value ?? 0;
          const rowAt = createErrorDiffusionRowDitherer({
            width,
            height,
            algorithm: mode,
            sMax: S_MAX,
            lumaRowAt: lumaRowAtFor(luma, width),
          });
          const forward = Array.from({ length: height }, (_, y) => y);
          expect(collectRows(rowAt, width, height, forward)).toEqual(
            materialized(luma, width, height, mode),
          );
        },
      ),
      { numRuns: 60 },
    );
  });

  it('replays deterministically on rewind: repeated and descending access match forward', () => {
    const width = 17;
    const height = 11;
    const luma = new Uint8Array(width * height);
    for (let i = 0; i < luma.length; i += 1) luma[i] = (i * 37) % 256;
    const make = () =>
      createErrorDiffusionRowDitherer({
        width,
        height,
        algorithm: 'floyd-steinberg',
        sMax: S_MAX,
        lumaRowAt: lumaRowAtFor(luma, width),
      });
    const reference = materialized(luma, width, height, 'floyd-steinberg');

    const forwardTwice = make();
    const firstScan = Array.from({ length: height }, (_, y) => y);
    collectRows(forwardTwice, width, height, firstScan);
    // Second full forward scan (multi-pass emit) rewinds to 0 and replays.
    expect(collectRows(forwardTwice, width, height, firstScan)).toEqual(reference);

    // Strictly descending access (the rotary row-reverse wrapper).
    const descending = make();
    const reverseOrder = Array.from({ length: height }, (_, y) => height - 1 - y);
    expect(collectRows(descending, width, height, reverseOrder)).toEqual(reference);

    // Same row twice returns the cached row without disturbing state.
    const cached = make();
    expect(cached(4)).toEqual(cached(4));
    expect(collectRows(cached, width, height, firstScan)).toEqual(reference);
  });

  it('rejects rows outside the image', () => {
    const rowAt = createErrorDiffusionRowDitherer({
      width: 2,
      height: 2,
      algorithm: 'floyd-steinberg',
      sMax: S_MAX,
      lumaRowAt: () => new Uint8Array(2),
    });
    expect(() => rowAt(-1)).toThrow();
    expect(() => rowAt(2)).toThrow();
  });
});
