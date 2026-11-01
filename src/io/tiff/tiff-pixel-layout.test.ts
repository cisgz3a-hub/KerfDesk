import { deflateSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { tiffDocument } from '../../__fixtures__/tiff-document';
import { decodeTiffPage } from './tiff-page';

function firstChannel(bytes: Uint8Array): number[] {
  return Array.from(decodeTiffPage(bytes, 1).rgba).filter((_, index) => index % 4 === 0);
}

function entryValue(bytes: Uint8Array, tag: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(8, true);
  for (let index = 0; index < count; index += 1) {
    const entry = 10 + index * 12;
    if (view.getUint16(entry, true) === tag) return entry + 8;
  }
  throw new Error('Missing fixture tag ' + tag);
}

describe('TIFF pixel block integrity', () => {
  it.each([true, false])('preserves every strip including a short final strip (%s)', (little) => {
    const bytes = tiffDocument(
      [
        {
          width: 2,
          height: 3,
          rowsPerStrip: 2,
          blocks: [
            [10, 20, 30, 40],
            [50, 60],
          ],
        },
      ],
      little,
    );
    const original = bytes.slice();
    expect(firstChannel(bytes)).toEqual([10, 20, 30, 40, 50, 60]);
    expect(bytes).toEqual(original);
  });

  it('rejects missing strips instead of accepting decoder zero-filled rows', () => {
    const bytes = tiffDocument([
      {
        width: 2,
        height: 2,
        rowsPerStrip: 1,
        blocks: [[99, 88]],
      },
    ]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/complete strip or tile offsets/);
  });

  it('requires exact strip counts and valid rows per strip', () => {
    const extra = tiffDocument([
      {
        width: 2,
        height: 1,
        rowsPerStrip: 1,
        blocks: [
          [10, 20],
          [30, 40],
        ],
      },
    ]);
    expect(() => decodeTiffPage(extra, 1)).toThrow(/complete strip or tile offsets/);
    const zeroRows = tiffDocument([{ rowsPerStrip: 0 }]);
    expect(() => decodeTiffPage(zeroRows, 1)).toThrow(/rows per strip/);
  });

  it('requires byte counts instead of inferring potentially incomplete source data', () => {
    const bytes = tiffDocument([{}]);
    new DataView(bytes.buffer).setUint16(entryValue(bytes, 279) - 8, 65000, true);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/complete strip or tile byte counts/);
  });

  it('rejects truncated pixel blocks using the actual input view length', () => {
    const bytes = tiffDocument([{}]);
    expect(() => decodeTiffPage(bytes.subarray(0, bytes.length - 1), 1)).toThrow(
      /pixel data extends beyond the file/,
    );
    const outside = bytes.slice();
    new DataView(outside.buffer).setUint32(entryValue(outside, 273), outside.length, true);
    expect(() => decodeTiffPage(outside, 1)).toThrow(/pixel data extends beyond the file/);
  });

  it('rejects short uncompressed blocks before asking the decoder for absent samples', () => {
    const bytes = tiffDocument([{ width: 2, height: 2, pixels: [10, 20, 30] }]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/Incomplete uncompressed TIFF pixel data/);
  });

  it('decodes complete compressed strips and refuses a compressed strip with missing samples', () => {
    const blocks = [
      [10, 20],
      [30, 40],
    ].map((pixels) => Array.from(deflateSync(new Uint8Array(pixels))));
    const bytes = tiffDocument([{ width: 2, height: 2, rowsPerStrip: 1, compression: 8, blocks }]);
    expect(firstChannel(bytes)).toEqual([10, 20, 30, 40]);
    const short = Array.from(deflateSync(new Uint8Array([30])));
    const incomplete = tiffDocument([
      { width: 2, height: 2, rowsPerStrip: 1, compression: 8, blocks: [blocks[0] ?? [], short] },
    ]);
    expect(() => decodeTiffPage(incomplete, 1)).toThrow(/^Incomplete TIFF pixel data\.$/);
  });

  it('rejects tiled RGB before the upstream decoder drops or shifts colour channels', () => {
    const block = Array.from({ length: 16 * 16 * 3 }, () => 0);
    block.splice(0, 6, 11, 22, 33, 44, 55, 66);
    const bytes = tiffDocument([
      {
        width: 2,
        height: 1,
        type: 2,
        components: 3,
        tileSize: [16, 16],
        blocks: [block],
      },
    ]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/tiled RGB or alpha TIFF/);
  });

  it('rejects mixed channel bit depths stored in typed metadata arrays', () => {
    const bytes = tiffDocument([
      {
        width: 2,
        height: 1,
        type: 2,
        components: 3,
        pixels: [11, 22, 0, 33, 44, 55, 0, 66],
      },
    ]);
    const view = new DataView(bytes.buffer);
    const bits = view.getUint32(entryValue(bytes, 258), true);
    view.setUint16(bits + 2, 16, true);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/matching bit depths/);
  });

  it('preserves tiled grayscale including a padded partial edge tile', () => {
    const first = Array.from({ length: 256 }, (_, index) => index % 256);
    const second = Array.from({ length: 256 }, () => 77);
    const bytes = tiffDocument([
      {
        width: 17,
        height: 1,
        tileSize: [16, 16],
        blocks: [first, second],
      },
    ]);
    expect(firstChannel(bytes)).toEqual([...Array.from({ length: 16 }, (_, index) => index), 77]);
  });

  it('refuses prediction that the decoder would incorrectly carry across tile boundaries', () => {
    const first = Array.from({ length: 256 }, (_, index) => (index === 0 ? 10 : 1));
    const second = Array.from({ length: 256 }, () => 20);
    const bytes = tiffDocument([
      {
        width: 17,
        height: 1,
        tileSize: [16, 16],
        predictor: 2,
        blocks: [first, second],
      },
    ]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/without tile prediction/);
    const strip = tiffDocument([{ width: 2, height: 1, predictor: 2, pixels: [10, 20] }]);
    expect(firstChannel(strip)).toEqual([10, 30]);
  });

  it.each([
    [0, 16],
    [16, 0],
  ] as const)('rejects invalid tile dimensions %i by %i', (w, h) => {
    const bytes = tiffDocument([{ tileSize: [w, h] }]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/Invalid TIFF tile/);
  });

  it('requires every tile and rejects truncated tile storage', () => {
    const block = Array.from({ length: 256 }, () => 99);
    const missing = tiffDocument([
      {
        width: 17,
        height: 1,
        tileSize: [16, 16],
        blocks: [block],
      },
    ]);
    expect(() => decodeTiffPage(missing, 1)).toThrow(/complete strip or tile offsets/);
    const short = tiffDocument([
      {
        width: 17,
        height: 1,
        tileSize: [16, 16],
        blocks: [block, block.slice(0, 16)],
      },
    ]);
    expect(() => decodeTiffPage(short, 1)).toThrow(/Incomplete uncompressed TIFF pixel data/);
  });

  it('rejects unsupported bit order instead of reflecting each group of eight pixels', () => {
    const reversed = tiffDocument([
      {
        width: 8,
        height: 1,
        bits: 1,
        fillOrder: 2,
        pixels: [1],
      },
    ]);
    expect(() => decodeTiffPage(reversed, 1)).toThrow(/most-significant-bit-first/);
    const supported = tiffDocument([
      {
        width: 8,
        height: 1,
        bits: 1,
        fillOrder: 1,
        pixels: [128],
      },
    ]);
    expect(firstChannel(supported)).toEqual([255, 0, 0, 0, 0, 0, 0, 0]);
    const invalid = tiffDocument([{ fillOrder: 0 }]);
    expect(() => decodeTiffPage(invalid, 1)).toThrow(/most-significant-bit-first/);
  });
});

// A TIFF LZW stream of the given codes, most significant bit first. Each code
// but the first after a Clear adds a table entry, and the code width grows by
// a bit when the table reaches 511, 1023 and 2047 entries (TIFF 6.0 section 13).
function lzwCodes(codes: readonly number[]): number[] {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  let width = 9;
  let table = 258;
  let first = false;
  for (const code of codes) {
    buffer = (buffer << width) | code;
    bits += width;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
    if (code === 256) [width, table, first] = [9, 258, true];
    else if (first) first = false;
    else if (code !== 257 && [511, 1023, 2047].includes(++table)) width += 1;
  }
  if (bits > 0) bytes.push((buffer << (8 - bits)) & 255);
  return bytes;
}

const LZW = 5;
const DEFLATE = 8;
const encoders = [
  [
    'Deflate',
    DEFLATE,
    (pixels: readonly number[]) => Array.from(deflateSync(Uint8Array.from(pixels))),
  ],
  ['LZW', LZW, (pixels: readonly number[]) => lzwCodes([256, ...pixels, 257])],
] as const;

describe.each(encoders)('TIFF %s strips decompress to their rows', (_name, compression, encode) => {
  const twoRows = (strips: readonly (readonly number[])[], rowsPerStrip = 1) =>
    tiffDocument([{ width: 2, height: 2, rowsPerStrip, compression, blocks: strips.map(encode) }]);

  it('decodes each strip', () => {
    expect(
      firstChannel(
        twoRows([
          [10, 20],
          [30, 40],
        ]),
      ),
    ).toEqual([10, 20, 30, 40]);
  });

  it('refuses a strip that holds more than its rows', () => {
    expect(() =>
      decodeTiffPage(
        twoRows([
          [10, 20],
          [30, 40, 50],
        ]),
        1,
      ),
    ).toThrow(/^TIFF decompressed data is too long\.$/);
  });

  it('refuses a strip that holds fewer samples than its rows', () => {
    expect(() => decodeTiffPage(twoRows([[10, 20], [30]]), 1)).toThrow(
      /^Incomplete TIFF pixel data\.$/,
    );
    expect(() => decodeTiffPage(twoRows([[10, 20], []]), 1)).toThrow(
      /^Incomplete TIFF pixel data\.$/,
    );
  });

  it('accepts a last strip padded to whole rows', () => {
    const blocks = [
      [10, 20, 30, 40],
      [50, 60, 0, 0],
    ].map(encode);
    const bytes = tiffDocument([{ width: 2, height: 3, rowsPerStrip: 2, compression, blocks }]);
    expect(firstChannel(bytes)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('holds a compressed tile to its tile size', () => {
    const tile = Array.from({ length: 256 }, (_, index) => index % 200);
    const tiled = (blocks: readonly (readonly number[])[]) =>
      tiffDocument([{ width: 16, height: 1, tileSize: [16, 16], compression, blocks }]);
    expect(firstChannel(tiled([encode(tile)]))).toEqual(tile.slice(0, 16));
    expect(() => decodeTiffPage(tiled([encode([...tile, 0])]), 1)).toThrow(
      /^TIFF decompressed data is too long\.$/,
    );
  });
});

describe('TIFF compressed data the decoder cannot read', () => {
  const oneRow = (compression: number, block: readonly number[]) =>
    tiffDocument([{ width: 2, height: 1, compression, blocks: [block] }]);

  it('refuses an LZW code that names an entry the strip has not made', () => {
    expect(() => decodeTiffPage(oneRow(LZW, lzwCodes([256, 300, 257])), 1)).toThrow(
      /^TIFF compressed data is damaged\.$/,
    );
    expect(() => decodeTiffPage(oneRow(LZW, lzwCodes([256, 10, 400, 257])), 1)).toThrow(
      /^TIFF compressed data is damaged\.$/,
    );
  });

  it('holds a gzip-wrapped strip to the length its trailer states', () => {
    const wrapped = Array.from(gzipSync(Uint8Array.from([10, 20])));
    expect(firstChannel(oneRow(DEFLATE, wrapped))).toEqual([10, 20]);
    const stated = wrapped.slice();
    stated.splice(-4, 4, 3, 0, 0, 0);
    expect(() => decodeTiffPage(oneRow(DEFLATE, stated), 1)).toThrow(
      /^TIFF decompressed data is too long\.$/,
    );
  });

  it('names a Deflate strip whose blocks cannot be read', () => {
    expect(() => decodeTiffPage(oneRow(DEFLATE, [0x78, 0x9c, 0xff, 0xff, 0, 0, 0, 0]), 1)).toThrow(
      /^TIFF compressed data is damaged\.$/,
    );
  });
});
