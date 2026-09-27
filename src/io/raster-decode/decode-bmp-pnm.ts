// BMP and Netpbm (PBM/PGM/PPM) decoding for headless tracing (ADR-477).
// Potrace's native inputs are PNM and BMP, so a shop moving a Potrace script
// to KerfDesk can feed the same files. BMP: 1/4/8-bit palette, 16/24/32-bit
// RGB and BI_BITFIELDS, bottom-up or top-down; RLE is refused clearly.
// Netpbm: P1-P6, any maxval, comments.

import type { DecodedRaster } from './decoded-raster';
import { assertRasterSize } from './decoded-raster';

const INCH_PER_METRE = 0.0254;

export function isBmp(bytes: Uint8Array): boolean {
  return bytes[0] === 0x42 && bytes[1] === 0x4d;
}

export function isPnm(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && (bytes[1] ?? 0) >= 0x31 && (bytes[1] ?? 0) <= 0x36;
}

export function decodeBmp(bytes: Uint8Array): DecodedRaster {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readBmpHeader(bytes, view);
  const { width, height, bpp, dibSize } = header;
  const masks = bitfieldMasks(view, dibSize, bpp, header.compression);
  const colours = view.getUint32(46, true) || (bpp <= 8 ? 1 << bpp : 0);
  const palette = bytes.subarray(14 + dibSize, 14 + dibSize + colours * 4);
  const stride = Math.ceil((bpp * width) / 32) * 4;
  if (header.pixelOffset + stride * height > bytes.length) {
    throw new Error('The BMP file is truncated.');
  }
  const data = new Uint8ClampedArray(width * height * 4);
  // Only a real alpha mask reports alpha; every other pixel is written opaque.
  let anyAlpha = masks[3] === 0;
  for (let y = 0; y < height; y += 1) {
    const stored = header.bottomUp ? height - 1 - y : y;
    const src = { bytes, view, row: header.pixelOffset + stored * stride, bpp, palette, masks };
    for (let x = 0; x < width; x += 1) {
      if (bmpPixel(src, x, data, (y * width + x) * 4) > 0) anyAlpha = true;
    }
  }
  // Like browsers, a BMP whose alpha channel is entirely zero is opaque.
  if (!anyAlpha) for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const x = view.getInt32(38, true) * INCH_PER_METRE;
  const y = view.getInt32(42, true) * INCH_PER_METRE;
  return { width, height, data, ...(x > 0 && y > 0 ? { dpi: { x, y } } : {}) };
}

type BmpHeader = {
  readonly pixelOffset: number;
  readonly dibSize: number;
  readonly width: number;
  readonly height: number;
  readonly bottomUp: boolean;
  readonly bpp: number;
  readonly compression: number;
};

function readBmpHeader(bytes: Uint8Array, view: DataView): BmpHeader {
  if (bytes.length < 54) throw new Error('The BMP file is truncated.');
  const dibSize = view.getUint32(14, true);
  if (dibSize < 40) throw new Error('This BMP header version is not supported.');
  const signedHeight = view.getInt32(22, true);
  const header = {
    pixelOffset: view.getUint32(10, true),
    dibSize,
    width: view.getInt32(18, true),
    height: Math.abs(signedHeight),
    bottomUp: signedHeight > 0,
    bpp: view.getUint16(28, true),
    compression: view.getUint32(30, true),
  };
  assertRasterSize(header.width, header.height);
  if (header.compression !== 0 && header.compression !== 3 && header.compression !== 6) {
    throw new Error('Compressed (RLE/JPEG/PNG) BMP files are not supported.');
  }
  return header;
}

type Masks = readonly [number, number, number, number];

function bitfieldMasks(view: DataView, dibSize: number, bpp: number, compression: number): Masks {
  if (compression === 0) {
    if (bpp === 16) return [0x7c00, 0x03e0, 0x001f, 0];
    return [0x00ff0000, 0x0000ff00, 0x000000ff, bpp === 32 ? 0xff000000 : 0];
  }
  if (bpp !== 16 && bpp !== 32) throw new Error('BMP bit fields need 16 or 32 bits per pixel.');
  const alpha = dibSize >= 56 || compression === 6 ? view.getUint32(66, true) : 0;
  return [view.getUint32(54, true), view.getUint32(58, true), view.getUint32(62, true), alpha];
}

type BmpRow = {
  readonly bytes: Uint8Array;
  readonly view: DataView;
  readonly row: number;
  readonly bpp: number;
  readonly palette: Uint8Array;
  readonly masks: Masks;
};

// Writes pixel x of the row to data[target..]; returns its alpha when the
// file carries a real alpha mask, else 0.
function bmpPixel(src: BmpRow, x: number, data: Uint8ClampedArray, target: number): number {
  if (src.bpp <= 8) return palettePixel(src, x, data, target);
  if (src.bpp === 24) {
    const at = src.row + x * 3;
    data.set([src.bytes[at + 2] ?? 0, src.bytes[at + 1] ?? 0, src.bytes[at] ?? 0, 255], target);
    return 0;
  }
  return maskedPixel(src, x, data, target);
}

function palettePixel(src: BmpRow, x: number, data: Uint8ClampedArray, target: number): number {
  const bit = x * src.bpp;
  const byte = src.bytes[src.row + (bit >> 3)] ?? 0;
  const index = (byte >> (8 - src.bpp - (bit & 7))) & ((1 << src.bpp) - 1);
  const entry = src.palette.subarray(index * 4, index * 4 + 3);
  data.set([entry[2] ?? 0, entry[1] ?? 0, entry[0] ?? 0, 255], target);
  return 0;
}

function maskedPixel(src: BmpRow, x: number, data: Uint8ClampedArray, target: number): number {
  const { bpp, view, row, masks } = src;
  if (bpp !== 16 && bpp !== 32) throw new Error(`Unsupported BMP depth: ${bpp} bits.`);
  const value = bpp === 16 ? view.getUint16(row + x * 2, true) : view.getUint32(row + x * 4, true);
  data[target] = maskedByte(value, masks[0]);
  data[target + 1] = maskedByte(value, masks[1]);
  data[target + 2] = maskedByte(value, masks[2]);
  const alpha = masks[3] === 0 ? 255 : maskedByte(value, masks[3]);
  data[target + 3] = alpha;
  return masks[3] === 0 ? 0 : alpha;
}

function maskedByte(value: number, mask: number): number {
  if (mask === 0) return 0;
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift += 1;
  const max = mask >>> shift;
  return Math.round((((value & mask) >>> shift) * 255) / max);
}

export function decodePnm(bytes: Uint8Array): DecodedRaster {
  const kind = (bytes[1] ?? 0) - 0x30;
  const reader = { bytes, offset: 2 };
  const width = headerInt(reader);
  const height = headerInt(reader);
  const maxval = pnmMaxval(reader, kind);
  assertRasterSize(width, height);
  reader.offset += 1; // the single whitespace byte before binary samples
  const channels = kind === 3 || kind === 6 ? 3 : 1;
  const data = new Uint8ClampedArray(width * height * 4);
  const rowBytes = Math.ceil(width / 8);
  for (let p = 0; p < width * height; p += 1) {
    const rgb =
      kind === 4
        ? [packedBit(bytes, reader.offset + Math.floor(p / width) * rowBytes, p % width)]
        : pnmPixel(reader, kind, channels, maxval);
    const [r = 0, g = r, b = r] = rgb;
    data.set([r, g, b, 255], p * 4);
  }
  return { width, height, data };
}

function pnmMaxval(reader: Reader, kind: number): number {
  if (kind === 1 || kind === 4) return 1;
  const maxval = headerInt(reader);
  if (maxval < 1 || maxval > 65535) throw new Error('The PNM maxval is out of range.');
  return maxval;
}

// P4: one bit per pixel, 1 is ink (black), rows padded to whole bytes.
function packedBit(bytes: Uint8Array, rowStart: number, x: number): number {
  const byte = bytes[rowStart + (x >> 3)];
  if (byte === undefined) throw new Error('The PNM file is truncated.');
  return (byte >> (7 - (x & 7))) & 1 ? 0 : 255;
}

function pnmPixel(reader: Reader, kind: number, channels: number, maxval: number): number[] {
  const samples = Array.from({ length: channels }, () => pnmSample(reader, kind, maxval));
  if (kind === 1) return [samples[0] === 1 ? 0 : 255];
  return samples.map((v) => Math.round((v * 255) / maxval));
}

type Reader = { readonly bytes: Uint8Array; offset: number };

function skipSpaceAndComments(reader: Reader): void {
  for (;;) {
    const byte = reader.bytes[reader.offset];
    if (byte === 0x23) {
      while (reader.offset < reader.bytes.length && reader.bytes[reader.offset] !== 0x0a) {
        reader.offset += 1;
      }
    } else if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
      reader.offset += 1;
    } else return;
  }
}

function headerInt(reader: Reader): number {
  skipSpaceAndComments(reader);
  let text = '';
  for (
    let byte = reader.bytes[reader.offset];
    byte !== undefined && byte >= 0x30 && byte <= 0x39;
  ) {
    text += String.fromCharCode(byte);
    reader.offset += 1;
    byte = reader.bytes[reader.offset];
  }
  if (text === '') throw new Error('The PNM header is malformed.');
  return Number(text);
}

function pnmSample(reader: Reader, kind: number, maxval: number): number {
  if (kind <= 3) {
    if (kind === 1) {
      skipSpaceAndComments(reader);
      const byte = reader.bytes[reader.offset];
      if (byte !== 0x30 && byte !== 0x31) throw new Error('The PBM data is malformed.');
      reader.offset += 1;
      return byte - 0x30;
    }
    return headerInt(reader);
  }
  const wide = maxval > 255;
  const hi = reader.bytes[reader.offset];
  const lo = wide ? reader.bytes[reader.offset + 1] : 0;
  if (hi === undefined || lo === undefined) throw new Error('The PNM file is truncated.');
  reader.offset += wide ? 2 : 1;
  return wide ? (hi << 8) | lo : hi;
}
