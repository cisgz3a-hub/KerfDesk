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

// The TIFF import's per-edge limit (tiff-page.ts), so no Netpbm file decodes
// larger than a TIFF could.
const MAX_PNM_EDGE = 16_384;
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
  const samples = header.kind === 'color' ? 3 : 1;
  // Prove the file can hold the raster before allocating it: a tiny corrupt
  // header must not allocate a gigabyte on the main thread.
  if (bytes.length - header.dataStart < minimumRasterBytes(header, samples)) {
    throw new Error(TRUNCATED);
  }
  const pixels = header.width * header.height;
  const rgba = new Uint8ClampedArray(pixels * 4);
  if (header.kind === 'bitmap') fillBitmap(bytes, header, rgba);
  else if (header.binary) fillBinarySamples(bytes, header, samples, rgba);
  else fillAsciiSamples(bytes, header, samples, rgba);
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
  if (width < 1 || height < 1 || width > MAX_PNM_EDGE || height > MAX_PNM_EDGE) {
    throw new Error(
      `This Netpbm image has an unusable size (each side must be 1-${MAX_PNM_EDGE} px).`,
    );
  }
  if (maxval < 1 || maxval > 65535) throw new Error('This Netpbm image has an unusable maxval.');
  // Exactly one whitespace byte separates a binary header from its raster.
  return { ...format, width, height, maxval, dataStart: cursor.at + 1 };
}

// The fewest raster bytes a well-formed file can carry. Plain samples need a
// digit each and whitespace between them; plain PBM digits need no separator.
function minimumRasterBytes(header: PnmHeader, samples: number): number {
  const pixels = header.width * header.height;
  if (header.kind === 'bitmap') {
    return header.binary ? Math.ceil(header.width / 8) * header.height : pixels - 1;
  }
  const count = pixels * samples;
  if (!header.binary) return 2 * count - 2;
  return count * (header.maxval > 255 ? 2 : 1);
}

function scaler(maxval: number): (value: number) => number {
  return (value) => Math.round((Math.min(value, maxval) * 255) / maxval);
}

function writeSample(rgba: Uint8ClampedArray, index: number, samples: number, value: number): void {
  if (samples === 3) {
    rgba[Math.floor(index / 3) * 4 + (index % 3)] = value;
    if (index % 3 === 2) rgba[Math.floor(index / 3) * 4 + 3] = 255;
    return;
  }
  rgba[index * 4] = value;
  rgba[index * 4 + 1] = value;
  rgba[index * 4 + 2] = value;
  rgba[index * 4 + 3] = 255;
}

function fillBinarySamples(
  bytes: Uint8Array,
  header: PnmHeader,
  samples: number,
  rgba: Uint8ClampedArray,
): void {
  const scale = scaler(header.maxval);
  const wide = header.maxval > 255;
  const start = header.dataStart;
  const count = header.width * header.height * samples;
  for (let i = 0; i < count; i += 1) {
    const value = wide
      ? (bytes[start + i * 2] ?? 0) * 256 + (bytes[start + i * 2 + 1] ?? 0)
      : (bytes[start + i] ?? 0);
    writeSample(rgba, i, samples, scale(value));
  }
}

// Plain samples are parsed straight into RGBA: no intermediate array of
// every sample value.
function fillAsciiSamples(
  bytes: Uint8Array,
  header: PnmHeader,
  samples: number,
  rgba: Uint8ClampedArray,
): void {
  const scale = scaler(header.maxval);
  const cursor: Cursor = { at: header.dataStart - 1 };
  const count = header.width * header.height * samples;
  for (let i = 0; i < count; i += 1)
    writeSample(rgba, i, samples, scale(nextInteger(bytes, cursor)));
}

// PBM: 1 is black. P4 packs each row into whole bytes, most significant first.
// Plain PBM digits need no separating whitespace ("0101" is four pixels).
function fillBitmap(bytes: Uint8Array, header: PnmHeader, rgba: Uint8ClampedArray): void {
  const pixels = header.width * header.height;
  const rowBytes = Math.ceil(header.width / 8);
  let at = header.dataStart - 1;
  for (let i = 0; i < pixels; i += 1) {
    let black: boolean;
    if (header.binary) {
      const y = Math.floor(i / header.width);
      const x = i - y * header.width;
      const byte = bytes[header.dataStart + y * rowBytes + Math.floor(x / 8)] ?? 0;
      black = Math.floor(byte / 2 ** (7 - (x % 8))) % 2 === 1;
    } else {
      at = skipSpaceAndComments(bytes, at);
      const byte = bytes[at];
      if (byte !== 0x30 && byte !== 0x31) throw new Error(TRUNCATED);
      black = byte === 0x31;
      at += 1;
    }
    writeSample(rgba, i, 1, black ? 0 : 255);
  }
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
