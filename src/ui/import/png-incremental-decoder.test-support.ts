import { deflateSync } from 'node:zlib';

export type PngFixtureOptions = {
  readonly width: number;
  readonly height: number;
  readonly rows: ReadonlyArray<ReadonlyArray<number>>;
  readonly colorType?: number;
  readonly bitDepth?: number;
  readonly interlace?: number;
  readonly filters?: ReadonlyArray<number>;
  readonly pixelsPerMetre?: number;
  readonly palette?: Uint8Array;
  readonly transparency?: Uint8Array;
  readonly transparencyAfterIdat?: boolean;
  readonly duplicateTransparency?: boolean;
};

export function makePng(options: PngFixtureOptions): Uint8Array {
  const colorType = options.colorType ?? 2;
  const bitDepth = options.bitDepth ?? 8;
  const channels = CHANNELS_BY_COLOR_TYPE[colorType] ?? 3;
  const bytesPerPixel = channels * bytesPerSample(bitDepth);
  const rawRows: Uint8Array[] = [];
  let previous = new Uint8Array(options.width * bytesPerPixel);
  for (let index = 0; index < options.rows.length; index += 1) {
    const row = Uint8Array.from(options.rows[index] ?? []);
    const filter = options.filters?.[index] ?? 0;
    rawRows.push(Uint8Array.of(filter), filterRow(row, previous, bytesPerPixel, filter));
    previous = row;
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, options.width);
  view.setUint32(4, options.height);
  ihdr[8] = bitDepth;
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
  const palette = options.palette === undefined ? [] : [chunk('PLTE', options.palette)];
  const transparency = transparencyChunks(options);
  return concat([
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    chunk('IHDR', ihdr),
    ...density,
    ...palette,
    ...transparency.beforeIdat,
    chunk('IDAT', compressed.subarray(0, split)),
    chunk('IDAT', compressed.subarray(split)),
    ...transparency.afterIdat,
    chunk('IEND', new Uint8Array()),
  ]);
}

/** Replace only IHDR dimensions and its CRC so header-only boundary tests need no huge allocation. */
export function withDeclaredPngDimensions(
  png: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const result = png.slice();
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(29, crc32(result.subarray(12, 29)));
  return result;
}

function transparencyChunks(
  options: Pick<
    PngFixtureOptions,
    'duplicateTransparency' | 'transparency' | 'transparencyAfterIdat'
  >,
): { readonly beforeIdat: Uint8Array[]; readonly afterIdat: Uint8Array[] } {
  if (options.transparency === undefined) return { beforeIdat: [], afterIdat: [] };
  const chunks = [chunk('tRNS', options.transparency)];
  if (options.duplicateTransparency === true) chunks.push(chunk('tRNS', options.transparency));
  return options.transparencyAfterIdat === true
    ? { beforeIdat: [], afterIdat: chunks }
    : { beforeIdat: chunks, afterIdat: [] };
}

export function streamingBlob(bytes: Uint8Array): Blob {
  return {
    size: bytes.length,
    stream: () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  } as Blob;
}

export async function* oneByteChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield* chunksOf(bytes, 1);
}

export async function* chunksOf(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, Math.min(bytes.length, offset + size));
  }
}

export function rgba(...values: number[]): number[] {
  return values;
}

/** Serialize numeric U16 samples in PNG network byte order. */
export function u16beBytes(...values: number[]): number[] {
  return values.flatMap((value) => [(value >>> 8) & 0xff, value & 0xff]);
}

function bytesPerSample(bitDepth: number): number {
  return bitDepth === 16 ? 2 : 1;
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

const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, number>> = { 0: 1, 4: 2, 6: 4 };

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
