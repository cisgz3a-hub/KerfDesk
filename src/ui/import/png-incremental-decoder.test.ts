import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { decodeIncrementalPngToLuma } from './png-incremental-decoder';
import { chunksOf, makePng, oneByteChunks, rgba } from './png-incremental-decoder.test-support';

describe('decodeIncrementalPngToLuma', () => {
  it('decodes split RGB input without retaining a full-file byte array', async () => {
    const png = makePng({
      width: 2,
      height: 2,
      rows: [
        [255, 0, 0, 0, 255, 0],
        [0, 0, 255, 255, 255, 255],
      ],
    });
    const rows: Uint8Array[] = [];

    const result = await decodeIncrementalPngToLuma(oneByteChunks(png), {
      maxEdge: 8,
      maxPixels: 64,
      onRow: (row) => {
        rows.push(row.slice());
      },
    });

    expect(result).toEqual({
      kind: 'ok',
      width: 2,
      height: 2,
      sampledWidth: 2,
      sampledHeight: 2,
      bitDepth: 8,
      colorType: 2,
      densityDpi: null,
    });
    expect(rows.map((row) => [...row])).toEqual([
      [76, 150],
      [29, 255],
    ]);
  });

  it('carries validated pHYs density without rereading the source file', async () => {
    const result = await decodeIncrementalPngToLuma(
      chunksOf(
        makePng({
          width: 1,
          height: 1,
          rows: [[10, 20, 30]],
          pixelsPerMetre: 11_811,
        }),
        5,
      ),
      {
        maxEdge: 8,
        maxPixels: 64,
        onRow: () => undefined,
      },
    );

    expect(result).toMatchObject({ kind: 'ok', densityDpi: 300 });
  });

  it('box-samples RGBA over white into bounded output rows', async () => {
    const png = makePng({
      width: 4,
      height: 2,
      colorType: 6,
      rows: [
        rgba(0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 0),
        rgba(255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 0),
      ],
    });
    const rows: Uint8Array[] = [];

    const result = await decodeIncrementalPngToLuma(chunksOf(png, 7), {
      maxEdge: 2,
      maxPixels: 2,
      onRow: (row) => {
        rows.push(row.slice());
      },
    });

    expect(result).toMatchObject({ kind: 'ok', sampledWidth: 2, sampledHeight: 1 });
    expect(rows.map((row) => [...row])).toEqual([[128, 255]]);
  });

  it('supports every PNG filter while keeping only current and previous rows', async () => {
    const rows = [
      [10, 20, 30],
      [20, 30, 40],
      [30, 40, 50],
      [40, 50, 60],
      [50, 60, 70],
    ];
    const png = makePng({ width: 1, height: 5, rows, filters: [0, 1, 2, 3, 4] });
    const decoded: number[] = [];

    await decodeIncrementalPngToLuma(chunksOf(png, 3), {
      maxEdge: 8,
      maxPixels: 64,
      onRow: (row) => {
        decoded.push(row[0] ?? -1);
      },
    });

    expect(decoded).toEqual([18, 28, 38, 48, 58]);
  });

  it('preserves qualified 8-bit grayscale samples exactly', async () => {
    const rows: number[][] = [];
    const png = makePng({
      width: 3,
      height: 2,
      colorType: 0,
      rows: [
        [0, 127, 255],
        [19, 87, 201],
      ],
      filters: [1, 4],
    });

    const result = await decodeIncrementalPngToLuma(chunksOf(png, 2), {
      maxEdge: 8,
      maxPixels: 64,
      onRow: (row) => {
        rows.push([...row]);
      },
    });

    expect(result).toMatchObject({ kind: 'ok', bitDepth: 8, colorType: 0 });
    expect(rows).toEqual([
      [0, 127, 255],
      [19, 87, 201],
    ]);
  });

  it('preserves arbitrary grayscale rows across every filter and chunk boundary', async () => {
    await fc.assert(
      fc.asyncProperty(
        grayscalePngCase(),
        async ({ width, height, samples, filters, chunkSize }) => {
          const rows = Array.from({ length: height }, (_, row) =>
            Array.from(samples.subarray(row * width, (row + 1) * width)),
          );
          const decodedRows: number[] = [];
          const result = await decodeIncrementalPngToLuma(
            chunksOf(makePng({ width, height, colorType: 0, rows, filters }), chunkSize),
            {
              maxEdge: 8,
              maxPixels: 64,
              onRow: (decoded) => {
                decodedRows.push(...decoded);
              },
            },
          );

          expect(result).toMatchObject({ kind: 'ok', width, height, bitDepth: 8, colorType: 0 });
          expect(decodedRows).toEqual(Array.from(samples));
        },
      ),
      { numRuns: 40 },
    );
  });

  it('publishes the exact grayscale tRNS sample after masking unused high bits', async () => {
    const rows: number[][] = [];
    const onTransparency = vi.fn();
    const result = await decodeIncrementalPngToLuma(
      chunksOf(
        makePng({
          width: 3,
          height: 1,
          colorType: 0,
          rows: [[7, 127, 200]],
          transparency: Uint8Array.of(0xff, 127),
        }),
        2,
      ),
      {
        maxEdge: 8,
        maxPixels: 64,
        onTransparency,
        onRow: (row) => {
          rows.push([...row]);
        },
      },
    );

    expect(result).toMatchObject({ kind: 'ok', bitDepth: 8, colorType: 0 });
    expect(rows).toEqual([[7, 127, 200]]);
    expect(onTransparency).toHaveBeenCalledOnce();
    expect(onTransparency).toHaveBeenCalledWith({ kind: 'grayscale-sample', sample: 127 });
  });

  it.each([
    {
      label: 'wrong byte length',
      png: () => grayscaleTransparencyPng({ transparency: Uint8Array.of(127) }),
      reason: /tRNS.*exactly 2 bytes/,
    },
    {
      label: 'after IDAT',
      png: () =>
        grayscaleTransparencyPng({
          transparency: Uint8Array.of(0, 127),
          transparencyAfterIdat: true,
        }),
      reason: /tRNS.*precede IDAT/,
    },
    {
      label: 'duplicate',
      png: () =>
        grayscaleTransparencyPng({
          transparency: Uint8Array.of(0, 127),
          duplicateTransparency: true,
        }),
      reason: /only one tRNS/,
    },
    {
      label: 'CRC mismatch',
      png: () =>
        corruptTransparencyCrc(grayscaleTransparencyPng({ transparency: Uint8Array.of(0, 127) })),
      reason: /tRNS CRC mismatch/,
    },
  ])('rejects grayscale tRNS with $label', async ({ png, reason }) => {
    await expect(
      decodeIncrementalPngToLuma(chunksOf(png(), 3), {
        maxEdge: 8,
        maxPixels: 64,
        onRow: () => undefined,
      }),
    ).rejects.toThrow(reason);
  });

  it('rejects a PLTE chunk in a grayscale PNG', async () => {
    const png = makePng({
      width: 1,
      height: 1,
      colorType: 0,
      rows: [[127]],
      palette: Uint8Array.of(0, 0, 0),
    });

    await expect(
      decodeIncrementalPngToLuma(chunksOf(png, 5), {
        maxEdge: 8,
        maxPixels: 64,
        onRow: () => undefined,
      }),
    ).rejects.toThrow(/PLTE.*not permitted.*grayscale/);
  });

  it.each([
    { colorType: 2, bitDepth: 16, interlace: 0, reason: /bit depth 16/ },
    { colorType: 2, bitDepth: 8, interlace: 1, reason: /interlaced/ },
  ])('routes an unqualified variant to the legacy fallback: $reason', async (variant) => {
    const onRow = vi.fn();
    const png = makePng({
      width: 1,
      height: 1,
      rows: [[10, 20, 30]],
      ...variant,
    });

    const result = await decodeIncrementalPngToLuma(chunksOf(png, 5), {
      maxEdge: 8,
      maxPixels: 64,
      onRow,
    });

    expect(result).toMatchObject({ kind: 'legacy-fallback' });
    if (result.kind !== 'legacy-fallback') throw new Error('expected fallback');
    expect(result.reason).toMatch(variant.reason);
    expect(onRow).not.toHaveBeenCalled();
  });

  it('rejects a critical-chunk CRC mismatch without publishing rows', async () => {
    const png = makePng({ width: 1, height: 1, rows: [[10, 20, 30]] });
    const ihdrLastCrcByte = 8 + 25 - 1;
    png[ihdrLastCrcByte] = (png[ihdrLastCrcByte] ?? 0) ^ 0xff;

    await expect(
      decodeIncrementalPngToLuma(chunksOf(png, 11), {
        maxEdge: 8,
        maxPixels: 64,
        onRow: () => undefined,
      }),
    ).rejects.toThrow(/CRC/);
  });

  it('honors cancellation between bounded input reads', async () => {
    const controller = new AbortController();
    const png = makePng({
      width: 1,
      height: 2,
      rows: [
        [10, 20, 30],
        [40, 50, 60],
      ],
    });

    await expect(
      decodeIncrementalPngToLuma(chunksOf(png, 1), {
        maxEdge: 8,
        maxPixels: 64,
        signal: controller.signal,
        onProgress: ({ encodedBytes }) => {
          if (encodedBytes > 20) controller.abort();
        },
        onRow: () => undefined,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function grayscalePngCase() {
  return fc
    .record({
      width: fc.integer({ min: 1, max: 8 }),
      height: fc.integer({ min: 1, max: 8 }),
    })
    .chain(({ width, height }) =>
      fc.record({
        width: fc.constant(width),
        height: fc.constant(height),
        samples: fc.uint8Array({ minLength: width * height, maxLength: width * height }),
        filters: fc.array(fc.integer({ min: 0, max: 4 }), {
          minLength: height,
          maxLength: height,
        }),
        chunkSize: fc.integer({ min: 1, max: 19 }),
      }),
    );
}

function grayscaleTransparencyPng(
  options: Pick<
    Parameters<typeof makePng>[0],
    'duplicateTransparency' | 'transparency' | 'transparencyAfterIdat'
  >,
): Uint8Array {
  return makePng({ width: 3, height: 1, colorType: 0, rows: [[7, 127, 200]], ...options });
}

function corruptTransparencyCrc(png: Uint8Array): Uint8Array {
  const typeOffset = png.findIndex(
    (byte, index) =>
      byte === 0x74 &&
      png[index + 1] === 0x52 &&
      png[index + 2] === 0x4e &&
      png[index + 3] === 0x53,
  );
  if (typeOffset < 4) throw new Error('fixture has no tRNS chunk');
  const length = new DataView(png.buffer, png.byteOffset + typeOffset - 4, 4).getUint32(0);
  const crcOffset = typeOffset + 4 + length;
  png[crcOffset] = (png[crcOffset] ?? 0) ^ 0xff;
  return png;
}
