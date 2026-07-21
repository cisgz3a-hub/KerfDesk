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
  rowAt: (y: number) => Uint16Array,
  width: number,
  height: number,
  order: ReadonlyArray<number>,
): Uint16Array {
  const out = new Uint16Array(width * height);
  for (const y of order) out.set(rowAt(y), y * width);
  return out;
}

describe('createErrorDiffusionRowDitherer', () => {
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
