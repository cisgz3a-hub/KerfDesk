// Whole-image PNG decoder for headless tracing (ADR-477). The app decodes
// imports with the browser; the trace command runs where no browser decoder
// exists, so it reads PNG itself: every colour type (grey, RGB, palette,
// grey+alpha, RGBA), every bit depth (1-16), tRNS transparency and Adam7
// interlacing. Inflate uses the web-standard DecompressionStream, so the
// module needs no dependency and no Node API. Output is straight
// (unpremultiplied) 8-bit RGBA, the samples a canvas decode of an 8-bit PNG
// yields; 16-bit samples are rounded to 8 bits.

import type { DecodedRaster } from './decoded-raster';
import { assertRasterSize } from './decoded-raster';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

type PngHeader = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly interlaced: boolean;
  readonly palette: Uint8Array | null;
  readonly transparency: Uint8Array | null;
  readonly idat: Uint8Array;
};

export function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((value, index) => bytes[index] === value);
}

export async function decodePng(bytes: Uint8Array): Promise<DecodedRaster> {
  const header = readPngChunks(bytes);
  const raw = await inflate(header.idat);
  const channels = CHANNELS[header.colorType] ?? 0;
  const bitsPerPixel = channels * header.bitDepth;
  const data = new Uint8ClampedArray(header.width * header.height * 4);
  const passes = header.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  let offset = 0;
  for (const [x0, y0, dx, dy] of passes) {
    const passWidth = Math.ceil((header.width - x0) / dx);
    const passHeight = Math.ceil((header.height - y0) / dy);
    if (passWidth <= 0 || passHeight <= 0) continue;
    const stride = Math.ceil((passWidth * bitsPerPixel) / 8);
    const rows = unfilter(raw, offset, stride, passHeight, Math.max(1, bitsPerPixel >> 3));
    offset += (stride + 1) * passHeight;
    for (let row = 0; row < passHeight; row += 1) {
      const line = rows.subarray(row * stride, (row + 1) * stride);
      for (let col = 0; col < passWidth; col += 1) {
        const target = ((y0 + row * dy) * header.width + x0 + col * dx) * 4;
        writePixel(data, target, line, col, channels, header);
      }
    }
  }
  return { width: header.width, height: header.height, data };
}

function readPngChunks(bytes: Uint8Array): PngHeader {
  if (!isPng(bytes)) throw new Error('Not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let ihdr: Uint8Array | null = null;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new Error('The PNG file is truncated.');
    if (type === 'IHDR') ihdr = body;
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (ihdr === null || ihdr.length < 13) throw new Error('The PNG file has no image header.');
  const head = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const header = {
    width: head.getUint32(0),
    height: head.getUint32(4),
    bitDepth: ihdr[8] ?? 0,
    colorType: ihdr[9] ?? 0,
    interlaced: ihdr[12] === 1,
    palette,
    transparency,
    idat: concat(idat),
  };
  validateHeader(header);
  return header;
}

function validateHeader(header: PngHeader): void {
  assertRasterSize(header.width, header.height);
  const channels = CHANNELS[header.colorType];
  const depths = header.colorType === 0 ? [1, 2, 4, 8, 16] : header.colorType === 3 ? [1, 2, 4, 8] : [8, 16];
  if (channels === undefined || !depths.includes(header.bitDepth)) {
    throw new Error(`Unsupported PNG colour type ${header.colorType} at ${header.bitDepth} bits.`);
  }
  if (header.colorType === 3 && header.palette === null) {
    throw new Error('The palette PNG has no palette.');
  }
  if (header.idat.length === 0) throw new Error('The PNG file has no image data.');
}

async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(compressed);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return concat(parts);
}

function unfilter(
  raw: Uint8Array,
  start: number,
  stride: number,
  rows: number,
  bpp: number,
): Uint8Array {
  if (start + (stride + 1) * rows > raw.length) throw new Error('The PNG image data is truncated.');
  const out = new Uint8Array(stride * rows);
  for (let row = 0; row < rows; row += 1) {
    const filter = raw[start + row * (stride + 1)];
    const src = start + row * (stride + 1) + 1;
    const at = row * stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? (out[at + i - bpp] ?? 0) : 0;
      const b = row > 0 ? (out[at - stride + i] ?? 0) : 0;
      const c = row > 0 && i >= bpp ? (out[at - stride + i - bpp] ?? 0) : 0;
      out[at + i] = ((raw[src + i] ?? 0) + predictor(filter, a, b, c)) & 0xff;
    }
    if (filter === undefined || filter > 4) throw new Error('The PNG uses an unknown row filter.');
  }
  return out;
}

function predictor(filter: number | undefined, a: number, b: number, c: number): number {
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return (a + b) >> 1;
  if (filter !== 4) return 0;
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function sample(line: Uint8Array, index: number, bitDepth: number): number {
  if (bitDepth === 8) return line[index] ?? 0;
  if (bitDepth === 16) return ((line[index * 2] ?? 0) << 8) | (line[index * 2 + 1] ?? 0);
  const bit = index * bitDepth;
  const byte = line[bit >> 3] ?? 0;
  return (byte >> (8 - bitDepth - (bit & 7))) & ((1 << bitDepth) - 1);
}

function writePixel(
  data: Uint8ClampedArray,
  target: number,
  line: Uint8Array,
  col: number,
  channels: number,
  header: PngHeader,
): void {
  const depth = header.bitDepth;
  const max = (1 << depth) - 1;
  const scale = (value: number): number => Math.round((value * 255) / max);
  if (header.colorType === 3) {
    const index = sample(line, col, depth);
    data[target] = header.palette?.[index * 3] ?? 0;
    data[target + 1] = header.palette?.[index * 3 + 1] ?? 0;
    data[target + 2] = header.palette?.[index * 3 + 2] ?? 0;
    data[target + 3] = header.transparency?.[index] ?? 255;
    return;
  }
  const values = Array.from({ length: channels }, (_, c) => sample(line, col * channels + c, depth));
  const grey = channels <= 2;
  const [r = 0, g = r, b = r] = grey ? [values[0], values[0], values[0]] : values;
  data[target] = scale(r);
  data[target + 1] = scale(g);
  data[target + 2] = scale(b);
  const alpha = channels === 2 || channels === 4 ? values[channels - 1] : undefined;
  data[target + 3] = alpha !== undefined ? scale(alpha) : keyedAlpha(values, header);
}

// tRNS on grey or RGB names one exact sample value that is fully transparent.
function keyedAlpha(values: ReadonlyArray<number>, header: PngHeader): number {
  const key = header.transparency;
  if (key === null) return 255;
  const matches = values.every(
    (value, c) => (((key[c * 2] ?? -1) << 8) | (key[c * 2 + 1] ?? -1)) === value,
  );
  return matches ? 0 : 255;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
