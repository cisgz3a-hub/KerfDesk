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
  const raw = await inflate(header.idat, scanlineBytes(header));
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
  const chunks = collectChunks(bytes);
  const ihdr = firstChunk(chunks, 'IHDR');
  if (ihdr === null || ihdr.length < 13) throw new Error('The PNG file has no image header.');
  const head = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const header = {
    width: head.getUint32(0),
    height: head.getUint32(4),
    bitDepth: ihdr[8] ?? 0,
    colorType: ihdr[9] ?? 0,
    interlaced: ihdr[12] === 1,
    palette: firstChunk(chunks, 'PLTE'),
    transparency: firstChunk(chunks, 'tRNS'),
    idat: concat(chunks.get('IDAT') ?? []),
  };
  validateHeader(header);
  return header;
}

function firstChunk(chunks: Map<string, Uint8Array[]>, type: string): Uint8Array | null {
  return chunks.get(type)?.[0] ?? null;
}

function collectChunks(bytes: Uint8Array): Map<string, Uint8Array[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = new Map<string, Uint8Array[]>();
  let offset = SIGNATURE.length;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (body.length !== length) throw new Error('The PNG file is truncated.');
    if (type === 'IEND') break;
    chunks.set(type, [...(chunks.get(type) ?? []), body]);
    offset += 12 + length;
  }
  return chunks;
}

function validateHeader(header: PngHeader): void {
  assertRasterSize(header.width, header.height);
  const channels = CHANNELS[header.colorType];
  const depths =
    header.colorType === 0 ? [1, 2, 4, 8, 16] : header.colorType === 3 ? [1, 2, 4, 8] : [8, 16];
  if (channels === undefined || !depths.includes(header.bitDepth)) {
    throw new Error(`Unsupported PNG colour type ${header.colorType} at ${header.bitDepth} bits.`);
  }
  if (header.colorType === 3 && header.palette === null) {
    throw new Error('The palette PNG has no palette.');
  }
  if (header.idat.length === 0) throw new Error('The PNG file has no image data.');
}

function scanlineBytes(header: PngHeader): number {
  const bits = (CHANNELS[header.colorType] ?? 0) * header.bitDepth;
  const passes = header.interlaced ? ADAM7 : ([[0, 0, 1, 1]] as const);
  return passes.reduce((total, [x0, y0, dx, dy]) => {
    const width = Math.max(0, Math.ceil((header.width - x0) / dx));
    const height = Math.max(0, Math.ceil((header.height - y0) / dy));
    return total + (width === 0 ? 0 : (Math.ceil((width * bits) / 8) + 1) * height);
  }, 0);
}

async function inflate(compressed: Uint8Array, expected: number): Promise<Uint8Array> {
  // A copy, so the stream holds a plain ArrayBuffer-backed view.
  const input = new Uint8Array(compressed);
  const source = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(input);
      controller.close();
    },
  });
  const reader = source.pipeThrough(new DecompressionStream('deflate')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > expected) {
      await reader.cancel();
      throw new Error('The PNG image data exceeds its declared dimensions.');
    }
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
    const filter = raw[start + row * (stride + 1)] ?? 0;
    if (filter > 4) throw new Error('The PNG uses an unknown row filter.');
    const line = raw.subarray(start + row * (stride + 1) + 1, start + (row + 1) * (stride + 1));
    unfilterRow(line, out, row * stride, row > 0 ? stride : 0, bpp, filter);
  }
  return out;
}

// `up` is the distance back to the previous row in `out`, 0 on the first row.
function unfilterRow(
  line: Uint8Array,
  out: Uint8Array,
  at: number,
  up: number,
  bpp: number,
  filter: number,
): void {
  for (let i = 0; i < line.length; i += 1) {
    const a = i >= bpp ? (out[at + i - bpp] ?? 0) : 0;
    const b = up > 0 ? (out[at - up + i] ?? 0) : 0;
    const c = up > 0 && i >= bpp ? (out[at - up + i - bpp] ?? 0) : 0;
    out[at + i] = ((line[i] ?? 0) + predictor(filter, a, b, c)) & 0xff;
  }
}

function predictor(filter: number, a: number, b: number, c: number): number {
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
    palettePixel(data, target, sample(line, col, depth), header);
    return;
  }
  const values = Array.from({ length: channels }, (_, c) =>
    sample(line, col * channels + c, depth),
  );
  const rgb = channels <= 2 ? [values[0], values[0], values[0]] : values.slice(0, 3);
  const hasAlpha = channels === 2 || channels === 4;
  const alpha = hasAlpha ? scale(values[channels - 1] ?? 0) : keyedAlpha(values, header);
  data.set([...rgb.map((value) => scale(value ?? 0)), alpha], target);
}

function palettePixel(
  data: Uint8ClampedArray,
  target: number,
  index: number,
  header: PngHeader,
): void {
  const entry = header.palette?.subarray(index * 3, index * 3 + 3) ?? new Uint8Array(3);
  data.set(
    [entry[0] ?? 0, entry[1] ?? 0, entry[2] ?? 0, header.transparency?.[index] ?? 255],
    target,
  );
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
