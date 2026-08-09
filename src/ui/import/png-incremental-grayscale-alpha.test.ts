import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { decodeIncrementalPngToHeightfieldSamples } from './png-incremental-decoder';
import {
  chunksOf,
  makePng,
  withDeclaredPngDimensions,
} from './png-incremental-decoder.test-support';

describe('decodeIncrementalPngToHeightfieldSamples grayscale alpha', () => {
  it('preserves exact gray and alpha channels through every filter and one-byte chunks', async () => {
    const grayscale = [
      [0, 1, 127, 255],
      [12, 64, 128, 200],
      [255, 128, 64, 0],
      [3, 7, 11, 19],
      [254, 129, 63, 2],
    ];
    const alpha = [
      [0, 1, 127, 128],
      [254, 255, 200, 42],
      [255, 0, 128, 64],
      [1, 3, 7, 15],
      [2, 63, 129, 254],
    ];
    const decodedRows: Uint8Array[] = [];

    const result = await decodeIncrementalPngToHeightfieldSamples(
      chunksOf(
        makePng({
          width: 4,
          height: 5,
          colorType: 4,
          rows: grayscale.map((row, index) => interleave(row, alpha[index] ?? [])),
          filters: [0, 1, 2, 3, 4],
        }),
        1,
      ),
      {
        onRow: (row) => {
          decodedRows.push(row.slice());
        },
      },
    );

    expect(result).toMatchObject({
      kind: 'ok',
      width: 4,
      height: 5,
      sampledWidth: 4,
      sampledHeight: 5,
      bitDepth: 8,
      colorType: 4,
    });
    expect(decodedRows.map(splitChannels)).toEqual(
      grayscale.map((gray, index) => ({ gray, alpha: alpha[index] })),
    );
  });

  it('preserves randomized grayscale-alpha rows across filters and stream boundaries', async () => {
    await fc.assert(
      fc.asyncProperty(alphaCase(), async ({ width, height, pixels, filters, chunkSize }) => {
        const decoded: number[] = [];
        const result = await decodeIncrementalPngToHeightfieldSamples(
          chunksOf(
            makePng({
              width,
              height,
              colorType: 4,
              rows: Array.from({ length: height }, (_, row) =>
                pixels.slice(row * width * 2, (row + 1) * width * 2),
              ),
              filters,
            }),
            chunkSize,
          ),
          {
            onRow: (row) => {
              decoded.push(...row);
            },
          },
        );

        expect(result).toMatchObject({ kind: 'ok', bitDepth: 8, colorType: 4 });
        expect(decoded).toEqual(pixels);
      }),
      { numRuns: 40 },
    );
  });

  it('reports exact source dimensions before decoding even beyond the safe pixel product', async () => {
    const dimension = 0xffffffff;
    const onHeader = vi.fn(() => {
      throw new Error('stop after exact header');
    });
    const png = withDeclaredPngDimensions(
      makePng({ width: 1, height: 1, colorType: 4, rows: [[90, 120]] }),
      dimension,
      dimension,
    );

    await expect(
      decodeIncrementalPngToHeightfieldSamples(chunksOf(png, 7), {
        onHeader,
        onRow: vi.fn(),
      }),
    ).rejects.toThrow('stop after exact header');
    expect(onHeader).toHaveBeenCalledWith({
      kind: 'ok',
      width: dimension,
      height: dimension,
      sampledWidth: dimension,
      sampledHeight: dimension,
      bitDepth: 8,
      colorType: 4,
    });
  });

  it('keeps interlaced grayscale-alpha outside the exact heightfield decoder', async () => {
    const onRow = vi.fn();
    const result = await decodeIncrementalPngToHeightfieldSamples(
      chunksOf(
        makePng({
          width: 1,
          height: 1,
          colorType: 4,
          interlace: 1,
          rows: [[90, 120]],
        }),
        3,
      ),
      { onRow },
    );

    expect(result).toEqual({
      kind: 'legacy-fallback',
      reason: 'interlaced PNG is not yet qualified',
    });
    expect(onRow).not.toHaveBeenCalled();
  });

  it('keeps 16-bit grayscale-alpha outside the exact heightfield decoder', async () => {
    const onRow = vi.fn();
    const result = await decodeIncrementalPngToHeightfieldSamples(
      chunksOf(
        makePng({
          width: 1,
          height: 1,
          colorType: 4,
          bitDepth: 16,
          rows: [[0x12, 0x34, 0x56, 0x78]],
        }),
        2,
      ),
      { onRow },
    );

    expect(result).toEqual({
      kind: 'legacy-fallback',
      reason: 'PNG bit depth 16 is not qualified for grayscale-alpha color type 4',
    });
    expect(onRow).not.toHaveBeenCalled();
  });

  it('rejects tRNS on grayscale-alpha instead of treating it as another mask', async () => {
    await expect(
      decodeIncrementalPngToHeightfieldSamples(
        chunksOf(
          makePng({
            width: 1,
            height: 1,
            colorType: 4,
            rows: [[90, 120]],
            transparency: Uint8Array.of(90),
          }),
          3,
        ),
        { onRow: vi.fn() },
      ),
    ).rejects.toThrow(/PNG tRNS is not permitted for grayscale-alpha color type 4/);
  });

  it('rejects a palette on grayscale-alpha', async () => {
    await expect(
      decodeIncrementalPngToHeightfieldSamples(
        chunksOf(
          makePng({
            width: 1,
            height: 1,
            colorType: 4,
            rows: [[90, 120]],
            palette: Uint8Array.of(0, 0, 0),
          }),
          5,
        ),
        { onRow: vi.fn() },
      ),
    ).rejects.toThrow(/PNG PLTE is not permitted for grayscale color type 4/);
  });
});

function alphaCase() {
  return fc
    .record({ width: fc.integer({ min: 1, max: 8 }), height: fc.integer({ min: 1, max: 8 }) })
    .chain(({ width, height }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        pixels: fc.array(fc.integer({ min: 0, max: 0xff }), {
          minLength: width * height * 2,
          maxLength: width * height * 2,
        }),
        filters: fc.array(fc.integer({ min: 0, max: 4 }), {
          minLength: height,
          maxLength: height,
        }),
        chunkSize: fc.integer({ min: 1, max: 19 }),
      }),
    );
}

function interleave(grayscale: ReadonlyArray<number>, alpha: ReadonlyArray<number>): number[] {
  return grayscale.flatMap((value, index) => [value, alpha[index] ?? 0]);
}

function splitChannels(row: Uint8Array): { readonly gray: number[]; readonly alpha: number[] } {
  const gray: number[] = [];
  const alpha: number[] = [];
  for (let index = 0; index < row.length; index += 2) {
    gray.push(row[index] ?? 0);
    alpha.push(row[index + 1] ?? 0);
  }
  return { gray, alpha };
}
