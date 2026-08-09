import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { decodeIncrementalPngToGrayscaleSamples } from './png-incremental-decoder';
import { chunksOf, makePng, u16beBytes } from './png-incremental-decoder.test-support';

describe('decodeIncrementalPngToGrayscaleSamples', () => {
  it('preserves exact U16 codes through every PNG filter and one-byte stream chunks', async () => {
    const values = [
      [0x0000, 0x00ff, 0x0100, 0xffff],
      [0x1234, 0x5678, 0x9abc, 0xdef0],
      [0x0102, 0x0304, 0x0506, 0x0708],
      [0x8000, 0x7fff, 0x00aa, 0xaa00],
      [0xffff, 0x0001, 0x0101, 0x1010],
    ];
    const decoded: number[][] = [];
    const result = await decodeIncrementalPngToGrayscaleSamples(
      chunksOf(
        makePng({
          width: 4,
          height: 5,
          colorType: 0,
          bitDepth: 16,
          rows: values.map((row) => u16beBytes(...row)),
          filters: [0, 1, 2, 3, 4],
        }),
        1,
      ),
      {
        onRow: (row) => {
          decoded.push(readU16be(row));
        },
      },
    );

    expect(result).toMatchObject({
      kind: 'ok',
      width: 4,
      height: 5,
      sampledWidth: 4,
      sampledHeight: 5,
      bitDepth: 16,
      colorType: 0,
    });
    expect(decoded).toEqual(values);
  });

  it('preserves random U16 rows across filters and external chunk boundaries', async () => {
    await fc.assert(
      fc.asyncProperty(grayscale16Case(), async ({ width, height, values, filters, chunkSize }) => {
        const rows = Array.from({ length: height }, (_, row) =>
          values.slice(row * width, (row + 1) * width),
        );
        const decoded: number[] = [];
        const result = await decodeIncrementalPngToGrayscaleSamples(
          chunksOf(
            makePng({
              width,
              height,
              colorType: 0,
              bitDepth: 16,
              rows: rows.map((row) => u16beBytes(...row)),
              filters,
            }),
            chunkSize,
          ),
          {
            onRow: (row) => {
              decoded.push(...readU16be(row));
            },
          },
        );

        expect(result).toMatchObject({ kind: 'ok', bitDepth: 16, colorType: 0 });
        expect(decoded).toEqual(values);
      }),
      { numRuns: 40 },
    );
  });

  it('keeps non-grayscale 16-bit PNG outside the exact height-map decoder', async () => {
    const onRow = vi.fn();
    const result = await decodeIncrementalPngToGrayscaleSamples(
      chunksOf(
        makePng({
          width: 1,
          height: 1,
          colorType: 2,
          bitDepth: 16,
          rows: [u16beBytes(0x1234, 0x5678, 0x9abc)],
        }),
        3,
      ),
      { onRow },
    );

    expect(result).toEqual({
      kind: 'legacy-fallback',
      reason: 'PNG color type 2 is not qualified',
    });
    expect(onRow).not.toHaveBeenCalled();
  });
});

function grayscale16Case() {
  return fc
    .record({ width: fc.integer({ min: 1, max: 8 }), height: fc.integer({ min: 1, max: 8 }) })
    .chain(({ width, height }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        values: fc.array(fc.integer({ min: 0, max: 0xffff }), {
          minLength: width * height,
          maxLength: width * height,
        }),
        filters: fc.array(fc.integer({ min: 0, max: 4 }), {
          minLength: height,
          maxLength: height,
        }),
        chunkSize: fc.integer({ min: 1, max: 19 }),
      }),
    );
}

function readU16be(bytes: Uint8Array): number[] {
  const values: number[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    values.push(((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0));
  }
  return values;
}
