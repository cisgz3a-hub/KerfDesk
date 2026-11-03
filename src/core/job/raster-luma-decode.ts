// Raster luma decode + a decode cache (PRF-05, extending ADR-050's caching).
//
// compileRasterGroup re-runs decode→adjust→resample→…→dither with no
// memoization, and every prepareOutput consumer (preview, live estimate,
// diagnostics, Save, Start) re-pays it independently — so the base64 luma decode
// ran once per consumer per rebuild. decodeRasterLuma memoizes the decode on the
// RasterImage's identity: the result depends only on obj.lumaBase64 and
// pixelWidth*pixelHeight (both intrinsic to obj), so it is output-invariant, and
// obj identity is stable across the rebuild loop / shared consumers (a real image
// edit replaces obj → natural miss). Identity-keyed, GC-bounded WeakMap — ADR-050's
// narrow module-mutable exception.

import { whiteLuma } from '../raster';
import { type RasterImage } from '../scene';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PADDING = 0x3d; // '='
const WHITESPACE = -2;
const INVALID = -1;
// Character code -> 6-bit value, WHITESPACE or INVALID. Decoding reads the
// original string through this table: building a cleaned copy one character at
// a time cost ~500 MB of rope nodes for a 12 MP photo (UX audit U3-P2-3).
const BASE64_VALUES = base64ValueTable();

const decodeCache = new WeakMap<RasterImage, Uint8Array>();

/** Per-pixel luma for a RasterImage, memoized on obj identity. */
export function decodeRasterLuma(obj: RasterImage): Uint8Array {
  const cached = decodeCache.get(obj);
  if (cached !== undefined) return cached;
  const expectedLength = obj.pixelWidth * obj.pixelHeight;
  const decoded =
    obj.lumaBase64 !== undefined
      ? decodeBase64Luma(obj.lumaBase64, expectedLength)
      : whiteLuma(expectedLength);
  decodeCache.set(obj, decoded);
  return decoded;
}

function decodeBase64Luma(base64: string, expectedLength: number): Uint8Array {
  const dataLength = validatedBase64DataLength(base64);
  const out = whiteLuma(expectedLength);
  let outIndex = 0;
  let buffer = 0;
  let bitCount = 0;
  let dataSeen = 0;
  for (let index = 0; dataSeen < dataLength; index += 1) {
    const value = BASE64_VALUES[base64.charCodeAt(index)] ?? INVALID;
    if (value === WHITESPACE) continue;
    dataSeen += 1;
    buffer = (buffer << 6) | value;
    bitCount += 6;
    if (bitCount >= 8) {
      bitCount -= 8;
      if (outIndex >= expectedLength) {
        throw new Error('compileRasterGroup: lumaBase64 is malformed');
      }
      out[outIndex] = (buffer >> bitCount) & 0xff;
      outIndex += 1;
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0 && buffer !== 0) {
    throw new Error('compileRasterGroup: lumaBase64 is malformed');
  }
  if (outIndex !== expectedLength) throw new Error('compileRasterGroup: lumaBase64 is malformed');
  return out;
}

/**
 * The count of data characters before any padding. Whitespace is skipped;
 * any other character outside the alphabet, padding that is not the last one
 * or two characters, and a length no base64 text can have are malformed.
 */
function validatedBase64DataLength(base64: string): number {
  let cleanLength = 0;
  let paddingStart = -1;
  for (let index = 0; index < base64.length; index += 1) {
    const code = base64.charCodeAt(index);
    const value = BASE64_VALUES[code] ?? INVALID;
    if (value === WHITESPACE) continue;
    if (code === PADDING) {
      if (paddingStart === -1) paddingStart = cleanLength;
    } else if (value === INVALID || paddingStart !== -1) {
      throw new Error('compileRasterGroup: lumaBase64 is malformed');
    }
    cleanLength += 1;
  }
  if (cleanLength % 4 === 1) throw new Error('compileRasterGroup: lumaBase64 is malformed');
  if (paddingStart === -1) return cleanLength;
  if (cleanLength - paddingStart > 2 || cleanLength % 4 !== 0) {
    throw new Error('compileRasterGroup: lumaBase64 is malformed');
  }
  return paddingStart;
}

function base64ValueTable(): Int8Array {
  const table = new Int8Array(128).fill(INVALID);
  for (let value = 0; value < BASE64_ALPHABET.length; value += 1) {
    table[BASE64_ALPHABET.charCodeAt(value)] = value;
  }
  for (const char of [' ', '\n', '\r', '\t']) table[char.charCodeAt(0)] = WHITESPACE;
  // Padding is validated by position, not decoded.
  table[PADDING] = INVALID;
  return table;
}
