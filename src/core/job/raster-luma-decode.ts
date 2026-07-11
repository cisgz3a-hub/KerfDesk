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
  const clean = cleanBase64Luma(base64);
  const dataLength = base64DataLength(clean);
  const out = whiteLuma(expectedLength);
  let outIndex = 0;
  let buffer = 0;
  let bitCount = 0;
  for (let index = 0; index < dataLength; index += 1) {
    const value = BASE64_ALPHABET.indexOf(clean[index] ?? '');
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

function cleanBase64Luma(base64: string): string {
  let clean = '';
  for (const char of base64) {
    if (isBase64Whitespace(char)) continue;
    if (char !== '=' && BASE64_ALPHABET.indexOf(char) === -1) {
      throw new Error('compileRasterGroup: lumaBase64 is malformed');
    }
    clean += char;
  }
  return clean;
}

function base64DataLength(clean: string): number {
  const paddingStart = clean.indexOf('=');
  if (clean.length % 4 === 1) throw new Error('compileRasterGroup: lumaBase64 is malformed');
  if (paddingStart === -1) return clean.length;
  const paddingCount = clean.length - paddingStart;
  if (
    paddingCount > 2 ||
    clean.length % 4 !== 0 ||
    clean.slice(paddingStart).replaceAll('=', '') !== ''
  ) {
    throw new Error('compileRasterGroup: lumaBase64 is malformed');
  }
  return paddingStart;
}

function isBase64Whitespace(char: string): boolean {
  return char === ' ' || char === '\n' || char === '\r' || char === '\t';
}
