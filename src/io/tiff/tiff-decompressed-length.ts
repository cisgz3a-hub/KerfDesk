import { Gunzip, Inflate, Unzlib } from 'fflate';

export const TIFF_DATA_TOO_LONG = 'TIFF decompressed data is too long.';
export const TIFF_DATA_INCOMPLETE = 'Incomplete TIFF pixel data.';
const TIFF_DATA_DAMAGED = 'TIFF compressed data is damaged.';

const LZW_COMPRESSION = 5;
const INPUT_CHUNK_BYTES = 8192;

/**
 * How many bytes the `tiff` decoder decompresses one LZW or Deflate strip or
 * tile into, counted without keeping them. Past `limit` it stops and refuses
 * the block, so no block decompresses to more than its image needs.
 */
export function decompressedBlockLength(
  block: Uint8Array,
  compression: number,
  limit: number,
): number {
  return compression === LZW_COMPRESSION ? lzwLength(block, limit) : deflateLength(block, limit);
}

// The decoder's `gunzipSync` sizes its output from the gzip trailer, so the
// trailer is held to the limit too.
function deflateLength(block: Uint8Array, limit: number): number {
  const gzip = block[0] === 31 && block[1] === 139 && block[2] === 8;
  if (gzip && gzipStatedLength(block) > limit) throw new Error(TIFF_DATA_TOO_LONG);
  let length = 0;
  let tooLong = false;
  const stream = deflateStream(block, gzip, (chunk) => {
    length += chunk.length;
    tooLong = length > limit;
    if (tooLong) throw new Error(TIFF_DATA_TOO_LONG);
  });
  try {
    // A chunk of input at a time, so the count stops soon after the limit.
    for (let start = 0; start < block.length; start += INPUT_CHUNK_BYTES) {
      const end = Math.min(start + INPUT_CHUNK_BYTES, block.length);
      stream.push(block.subarray(start, end), end === block.length);
    }
  } catch (error) {
    if (tooLong) throw error;
    // fflate's code 0 is "unexpected EOF": the stream stops before its end.
    throw new Error(flateErrorCode(error) === 0 ? TIFF_DATA_INCOMPLETE : TIFF_DATA_DAMAGED);
  }
  return gzip ? Math.min(length, gzipStatedLength(block)) : length;
}

// The stream the decoder's fflate `decompressSync` picks from the first bytes:
// gzip, else zlib when they make a zlib header, else raw DEFLATE.
function deflateStream(
  block: Uint8Array,
  gzip: boolean,
  onData: (chunk: Uint8Array) => void,
): Gunzip | Inflate | Unzlib {
  if (gzip) return new Gunzip(onData);
  const [first = 0, second = 0] = block;
  const zlib = (first & 15) === 8 && first >> 4 <= 7 && ((first << 8) | second) % 31 === 0;
  return zlib ? new Unzlib(onData) : new Inflate(onData);
}

function gzipStatedLength(block: Uint8Array): number {
  const end = block.length;
  const byte = (index: number): number => block[index] ?? 0;
  return (
    (byte(end - 4) | (byte(end - 3) << 8) | (byte(end - 2) << 16) | (byte(end - 1) << 24)) >>> 0
  );
}

function flateErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

const CLEAR_CODE = 256;
const END_CODE = 257;
const FIRST_FREE_CODE = 258;
const TABLE_SIZE = 4096;
const CODE_MASKS: readonly number[] = [511, 1023, 2047, 4095];
// The table length at which each code width widens by one bit.
const WIDTH_STEPS: readonly number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 511, 1023, 2047, 4095];

/**
 * The `tiff` 7.1.3 LZW reader (lib/lzw.js) step for step, keeping only the
 * length of each table entry. That reader's table outlives a block, so a code
 * naming an entry this block has not made would repeat an earlier block's
 * bytes; such a block is damaged.
 */
function lzwLength(block: Uint8Array, limit: number): number {
  const lengths = new Uint16Array(TABLE_SIZE + 1).fill(1, 0, CLEAR_CODE);
  let tableLength = FIRST_FREE_CODE;
  let width = 9;
  let data = 0;
  let bits = 0;
  let pointer = 0;
  let length = 0;
  let oldCode = 0;
  const nextCode = (): number => {
    data = (data << 8) | (block[pointer++] ?? 0);
    bits += 8;
    if (bits < width) {
      data = (data << 8) | (block[pointer++] ?? 0);
      bits += 8;
    }
    const code = (data >> (bits - width)) & (CODE_MASKS[width - 9] ?? 0);
    bits -= width;
    return pointer > block.length ? END_CODE : code;
  };
  const write = (count: number): void => {
    length += count;
    if (length > limit) throw new Error(TIFF_DATA_TOO_LONG);
  };
  const add = (entryLength: number): void => {
    if (tableLength === TABLE_SIZE) throw new Error(TIFF_DATA_DAMAGED);
    lengths[tableLength] = entryLength;
    tableLength += 1;
    if (tableLength === WIDTH_STEPS[width]) width += 1;
  };
  for (let code = nextCode(); code !== END_CODE; code = nextCode()) {
    if (code === CLEAR_CODE) {
      tableLength = FIRST_FREE_CODE;
      width = 9;
      code = nextCode();
      if (code === END_CODE) break;
      if (code >= FIRST_FREE_CODE) throw new Error(TIFF_DATA_DAMAGED);
      write(lengths[code] ?? 0);
    } else {
      if (code > tableLength) throw new Error(TIFF_DATA_DAMAGED);
      const entryLength = (lengths[oldCode] ?? 0) + 1;
      write(code < tableLength ? (lengths[code] ?? 0) : entryLength);
      add(entryLength);
    }
    oldCode = code;
  }
  return length;
}
