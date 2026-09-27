// Netpbm (PBM / PGM / PPM, P1-P6) decoder for Multi-File Trace, so mkbitmap
// and scanner-tool output can be traced without converting it first. Netpbm
// carries no resolution, so the caller sizes a decode at the default DPI.

export type PnmPixels = {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
};

type PnmKind = 'bitmap' | 'gray' | 'color';

type PnmHeader = {
  readonly kind: PnmKind;
  readonly binary: boolean;
  readonly width: number;
  readonly height: number;
  readonly maxval: number;
  readonly dataStart: number;
};

type Cursor = { at: number };

const MAX_PNM_PIXELS = 268_435_456;
const TRUNCATED = 'This Netpbm image is truncated.';
const MAGIC: Readonly<Record<string, { readonly kind: PnmKind; readonly binary: boolean }>> = {
  P1: { kind: 'bitmap', binary: false },
  P2: { kind: 'gray', binary: false },
  P3: { kind: 'color', binary: false },
  P4: { kind: 'bitmap', binary: true },
  P5: { kind: 'gray', binary: true },
  P6: { kind: 'color', binary: true },
};

/** Whether a file name is a Netpbm image this decoder reads. */
export function isPnmFileName(name: string): boolean {
  return /\.(pbm|pgm|ppm|pnm)$/i.test(name);
}

/** Decode the first image of a P1-P6 file to opaque RGBA. */
export function decodePnm(bytes: Uint8Array): PnmPixels {
  const header = readHeader(bytes);
  const pixels = header.width * header.height;
  const rgba = new Uint8ClampedArray(pixels * 4);
  const samples = header.kind === 'color' ? 3 : 1;
  const read = sampleReader(bytes, header, samples);
  for (let i = 0; i < pixels; i += 1) {
    const first = read(i, 0);
    rgba[i * 4] = first;
    rgba[i * 4 + 1] = samples === 3 ? read(i, 1) : first;
    rgba[i * 4 + 2] = samples === 3 ? read(i, 2) : first;
    rgba[i * 4 + 3] = 255;
  }
  return { width: header.width, height: header.height, rgba };
}

function readHeader(bytes: Uint8Array): PnmHeader {
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  const format = MAGIC[magic];
  if (format === undefined) throw new Error('This is not a PBM, PGM or PPM image.');
  const cursor: Cursor = { at: 2 };
  const width = nextInteger(bytes, cursor);
  const height = nextInteger(bytes, cursor);
  const maxval = format.kind === 'bitmap' ? 1 : nextInteger(bytes, cursor);
  if (width < 1 || height < 1 || width * height > MAX_PNM_PIXELS) {
    throw new Error('This Netpbm image has an unusable size.');
  }
  if (maxval < 1 || maxval > 65535) throw new Error('This Netpbm image has an unusable maxval.');
  // Exactly one whitespace byte separates a binary header from its raster.
  return { ...format, width, height, maxval, dataStart: cursor.at + 1 };
}

function sampleReader(
  bytes: Uint8Array,
  header: PnmHeader,
  samples: number,
): (pixel: number, channel: number) => number {
  if (header.kind === 'bitmap') return bitmapReader(bytes, header);
  const scale = (value: number): number => Math.round((value * 255) / header.maxval);
  if (!header.binary) {
    const count = header.width * header.height * samples;
    const values = asciiSamples(bytes, header.dataStart - 1, count);
    return (pixel, channel) => scale(values[pixel * samples + channel] ?? 0);
  }
  const wide = header.maxval > 255;
  const needed = header.width * header.height * samples * (wide ? 2 : 1);
  if (header.dataStart + needed > bytes.length) throw new Error(TRUNCATED);
  const start = header.dataStart;
  return (pixel, channel) => {
    const index = pixel * samples + channel;
    if (!wide) return scale(bytes[start + index] ?? 0);
    const high = bytes[start + index * 2] ?? 0;
    const low = bytes[start + index * 2 + 1] ?? 0;
    return scale(high * 256 + low);
  };
}

// PBM: 1 is black. P4 packs each row into whole bytes, most significant first.
function bitmapReader(bytes: Uint8Array, header: PnmHeader): (pixel: number) => number {
  if (!header.binary) {
    const bits = asciiBits(bytes, header.dataStart - 1, header.width * header.height);
    return (pixel) => (bits[pixel] === 1 ? 0 : 255);
  }
  const rowBytes = Math.ceil(header.width / 8);
  if (header.dataStart + rowBytes * header.height > bytes.length) throw new Error(TRUNCATED);
  return (pixel) => {
    const y = Math.floor(pixel / header.width);
    const x = pixel - y * header.width;
    const byte = bytes[header.dataStart + y * rowBytes + Math.floor(x / 8)] ?? 0;
    return Math.floor(byte / 2 ** (7 - (x % 8))) % 2 === 1 ? 0 : 255;
  };
}

function asciiSamples(bytes: Uint8Array, start: number, count: number): Uint32Array {
  const values = new Uint32Array(count);
  const cursor: Cursor = { at: start };
  for (let i = 0; i < count; i += 1) values[i] = nextInteger(bytes, cursor);
  return values;
}

// Plain PBM digits need no separating whitespace ("0101" is four pixels).
function asciiBits(bytes: Uint8Array, start: number, count: number): Uint8Array {
  const bits = new Uint8Array(count);
  let at = start;
  for (let i = 0; i < count; i += 1) {
    at = skipSpaceAndComments(bytes, at);
    const byte = bytes[at];
    if (byte !== 0x30 && byte !== 0x31) throw new Error(TRUNCATED);
    bits[i] = byte - 0x30;
    at += 1;
  }
  return bits;
}

function isDigit(byte: number | undefined): byte is number {
  return byte !== undefined && byte >= 0x30 && byte <= 0x39;
}

function nextInteger(bytes: Uint8Array, cursor: Cursor): number {
  let at = skipSpaceAndComments(bytes, cursor.at);
  let value = 0;
  const first = at;
  for (let byte = bytes[at]; isDigit(byte); byte = bytes[at]) {
    value = value * 10 + (byte - 0x30);
    at += 1;
  }
  if (at === first) throw new Error(TRUNCATED);
  cursor.at = at;
  return value;
}

function isSpace(byte: number): boolean {
  return byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
}

function skipSpaceAndComments(bytes: Uint8Array, start: number): number {
  let at = start;
  let inComment = false;
  for (; at < bytes.length; at += 1) {
    const byte = bytes[at] ?? 0;
    if (inComment) inComment = byte !== 0x0a && byte !== 0x0d;
    else if (byte === 0x23) inComment = true;
    else if (!isSpace(byte)) return at;
  }
  return at;
}
