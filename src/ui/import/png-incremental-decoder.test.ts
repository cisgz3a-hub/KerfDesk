import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { decodeIncrementalPngToLuma } from './png-incremental-decoder';

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

  it.each([
    { colorType: 0, bitDepth: 8, interlace: 0, reason: /color type 0/ },
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

type PngOptions = {
  readonly width: number;
  readonly height: number;
  readonly rows: ReadonlyArray<ReadonlyArray<number>>;
  readonly colorType?: number;
  readonly bitDepth?: number;
  readonly interlace?: number;
  readonly filters?: ReadonlyArray<number>;
  readonly pixelsPerMetre?: number;
};

function makePng(options: PngOptions): Uint8Array {
  const colorType = options.colorType ?? 2;
  const channels = colorType === 6 ? 4 : 3;
  const rawRows: Uint8Array[] = [];
  let previous = new Uint8Array(options.width * channels);
  for (let index = 0; index < options.rows.length; index += 1) {
    const row = Uint8Array.from(options.rows[index] ?? []);
    const filter = options.filters?.[index] ?? 0;
    rawRows.push(Uint8Array.of(filter), filterRow(row, previous, channels, filter));
    previous = row;
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width);
  view.setUint32(4, options.height);
  ihdr[8] = options.bitDepth ?? 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = options.interlace ?? 0;
  const compressed = new Uint8Array(deflateSync(concat(rawRows)));
  const split = Math.max(1, Math.floor(compressed.length / 2));
  const density =
    options.pixelsPerMetre === undefined
      ? []
      : [chunk('pHYs', physicalDimensions(options.pixelsPerMetre))];
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    ...density,
    chunk('IDAT', compressed.subarray(0, split)),
    chunk('IDAT', compressed.subarray(split)),
    chunk('IEND', new Uint8Array()),
  ]);
}

function physicalDimensions(pixelsPerMetre: number): Uint8Array {
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, pixelsPerMetre);
  view.setUint32(4, pixelsPerMetre);
  data[8] = 1;
  return data;
}

function filterRow(
  row: Uint8Array,
  previous: Uint8Array,
  channels: number,
  filter: number,
): Uint8Array {
  const filtered = new Uint8Array(row.length);
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= channels ? (row[index - channels] ?? 0) : 0;
    const up = previous[index] ?? 0;
    const upLeft = index >= channels ? (previous[index - channels] ?? 0) : 0;
    const predictor =
      filter === 1
        ? left
        : filter === 2
          ? up
          : filter === 3
            ? (left + up) >> 1
            : filter === 4
              ? paeth(left, up, upLeft)
              : 0;
    filtered[index] = ((row[index] ?? 0) - predictor) & 0xff;
  }
  return filtered;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from(type, (character) => character.charCodeAt(0));
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(data.length + 8, crc32(concat([typeBytes, data])));
  return result;
}

async function* oneByteChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield* chunksOf(bytes, 1);
}

async function* chunksOf(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
  }
}

function rgba(...values: number[]): number[] {
  return values;
}

function paeth(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const diagonalDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= diagonalDistance) return left;
  return upDistance <= diagonalDistance ? up : upLeft;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

const CRC_TABLE = buildCrcTable();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}
