// Minimal PNG decoder for the centerline harness: turns a real logo PNG on disk
// into the RGBA RawImageData the tracer sees after the browser decodes an
// import. Self-contained (node:fs + node:zlib), no new dependency — mirrors the
// png.ts encoder. Supports 8-bit truecolour (RGB type 2 / RGBA type 6),
// non-interlaced — the format design tools export. Throws clearly on anything
// else. Test-only (src/__fixtures__ is boundary/coverage-exempt).

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { RawImageData } from '../../core/trace';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;

type Header = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlace: number;
  readonly idat: Uint8Array;
};

export function decodePngFile(path: string): RawImageData {
  return decodePng(new Uint8Array(readFileSync(path)));
}

export function decodePng(bytes: Uint8Array): RawImageData {
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error('Not a PNG (bad signature)');
  }
  const header = readChunks(bytes);
  if (header.bitDepth !== 8) throw new Error(`PNG bit depth ${header.bitDepth} unsupported (need 8)`);
  if (header.interlace !== 0) throw new Error('Interlaced PNG unsupported');
  const channels =
    header.colorType === 6 ? RGBA_CHANNELS : header.colorType === 2 ? RGB_CHANNELS : 0;
  if (channels === 0) throw new Error(`PNG colour type ${header.colorType} unsupported (need 2/6)`);
  const raw = new Uint8Array(inflateSync(header.idat));
  const pixels = unfilter(raw, header.width, header.height, channels);
  return toRgba(pixels, header.width, header.height, channels);
}

function readChunks(bytes: Uint8Array): Header {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [];
  let off = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(...bytes.subarray(off + 4, off + 8));
    const data = off + 8;
    if (type === 'IHDR') {
      width = view.getUint32(data);
      height = view.getUint32(data + 4);
      bitDepth = bytes[data + 8] ?? 0;
      colorType = bytes[data + 9] ?? 0;
      interlace = bytes[data + 12] ?? 0;
    } else if (type === 'IDAT') {
      parts.push(bytes.subarray(data, data + len));
    } else if (type === 'IEND') break;
    off = data + len + 4;
  }
  return { width, height, bitDepth, colorType, interlace, idat: concat(parts) };
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function predict(filter: number, a: number, b: number, c: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return a;
    case 2:
      return b;
    case 3:
      return (a + b) >> 1;
    case 4:
      return paeth(a, b, c);
    default:
      throw new Error(`Unknown PNG filter ${filter}`);
  }
}

function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos] ?? 0;
    pos += 1;
    const rowBase = y * stride;
    const upBase = rowBase - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (out[rowBase + x - channels] ?? 0) : 0;
      const up = y > 0 ? (out[upBase + x] ?? 0) : 0;
      const upLeft = x >= channels && y > 0 ? (out[upBase + x - channels] ?? 0) : 0;
      out[rowBase + x] = ((raw[pos + x] ?? 0) + predict(filter, left, up, upLeft)) & 0xff;
    }
    pos += stride;
  }
  return out;
}

function toRgba(pixels: Uint8Array, width: number, height: number, channels: number): RawImageData {
  const data = new Uint8ClampedArray(width * height * RGBA_CHANNELS);
  for (let i = 0; i < width * height; i += 1) {
    const s = i * channels;
    const d = i * RGBA_CHANNELS;
    data[d] = pixels[s] ?? 0;
    data[d + 1] = pixels[s + 1] ?? 0;
    data[d + 2] = pixels[s + 2] ?? 0;
    data[d + 3] = channels === RGBA_CHANNELS ? (pixels[s + 3] ?? 255) : 255;
  }
  return { width, height, data };
}
