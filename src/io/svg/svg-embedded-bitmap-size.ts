// The pixel size of an embedded PNG, JPEG, BMP or WebP image, read from its
// header without decoding it. preserveAspectRatio fits the image by this size,
// so a JPEG or PNG whose EXIF Orientation turns it a quarter turn reports the
// turned size a browser displays and KerfDesk's decoder produces. The
// Orientation is read as Chromium reads it (io/raster-decode/exif-orientation.ts,
// shared with the file import's ui/trace/jpeg-header.ts and png-header.ts).
// Formats are sniffed from the bytes, as browsers decode data URLs by content.

import { exifBlockOrientation, pngExifOrientation } from '../raster-decode/exif-orientation';

export type BitmapSize = { readonly width: number; readonly height: number };

const PAYLOAD = /^data:image\/[a-z]+;base64,/i;
// Bytes enough for every fixed-position header below.
const FIXED_HEADER_BYTES = 32;
// A JPEG frame header follows its metadata segments, and a PNG eXIf chunk may
// follow others before IDAT; read further only as needed.
const FIRST_METADATA_READ = 64 * 1024;
const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

/** The displayed pixel size of a base64 bitmap data URL, or null when its header cannot be read. */
export function embeddedBitmapSize(dataUrl: string): BitmapSize | null {
  const header = PAYLOAD.exec(dataUrl);
  if (header === null) return null;
  const payload = dataUrl.slice(header[0].length);
  const bytes = base64Prefix(payload, FIXED_HEADER_BYTES);
  if (bytes === null) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(payload);
  const png = pngSize(bytes);
  if (png !== null) return orientedPngSize(payload, png);
  return bmpSize(bytes) ?? webpSize(bytes);
}

// Decodes the first `byteCount` bytes, skipping the XML whitespace an exporter
// may wrap the payload with. Returns fewer bytes when the payload is shorter.
function base64Prefix(payload: string, byteCount: number): Uint8Array | null {
  const wanted = Math.ceil(byteCount / 3) * 4;
  let text = '';
  for (let at = 0; at < payload.length && text.length < wanted; at += wanted) {
    text += payload.slice(at, at + wanted).replace(/\s+/g, '');
  }
  text = text.slice(0, wanted);
  let binary: string;
  try {
    binary = atob(text.slice(0, text.length - (text.length % 4)));
  } catch {
    return null;
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pngSize(bytes: Uint8Array): BitmapSize | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  return positive(uint(bytes, 16, 4, false), uint(bytes, 20, 4, false));
}

function bmpSize(bytes: Uint8Array): BitmapSize | null {
  if (ascii(bytes, 0, 2) !== 'BM') return null;
  const infoSize = uint(bytes, 14, 4, true);
  // BITMAPCOREHEADER stores unsigned 16-bit sizes; later headers signed 32-bit,
  // with a negative height for top-down rows.
  if (infoSize === 12) return positive(uint(bytes, 18, 2, true), uint(bytes, 20, 2, true));
  if (infoSize < 40) return null;
  const width = uint(bytes, 18, 4, true) | 0;
  const height = uint(bytes, 22, 4, true) | 0;
  return positive(width, Math.abs(height));
}

function webpSize(bytes: Uint8Array): BitmapSize | null {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') return positive(uint(bytes, 24, 3, true) + 1, uint(bytes, 27, 3, true) + 1);
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = uint(bytes, 21, 4, true);
    return positive((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return positive(uint(bytes, 26, 2, true) & 0x3fff, uint(bytes, 28, 2, true) & 0x3fff);
  }
  return null;
}

function jpegSize(payload: string): BitmapSize | null {
  const size = readGrowingPrefix(payload, jpegFrameSize);
  // 'more': the payload ended before the frame header.
  return size === 'more' ? null : size;
}

// An eXIf the payload ends before is no Orientation: the browser reads none.
function orientedPngSize(payload: string, stored: BitmapSize): BitmapSize {
  const orientation = readGrowingPrefix(payload, (bytes) => pngExifOrientation(bytes) ?? 'more');
  if (orientation === 'more' || orientation === null || orientation < 5) return stored;
  return { width: stored.height, height: stored.width };
}

// Decodes ever longer prefixes of the payload until `read` stops asking for
// 'more' or the payload ends (then 'more'); null when the base64 is unreadable.
function readGrowingPrefix<T>(
  payload: string,
  read: (bytes: Uint8Array) => T | 'more',
): T | 'more' | null {
  for (let wanted = FIRST_METADATA_READ; ; wanted *= 4) {
    const bytes = base64Prefix(payload, wanted);
    if (bytes === null) return null;
    const result = read(bytes);
    if (result !== 'more' || bytes.length < wanted) return result;
  }
}

// Walks the marker segments to the first start-of-frame header; the first
// Exif APP1 before it gives the orientation. 'more' asks for more bytes.
function jpegFrameSize(bytes: Uint8Array): BitmapSize | null | 'more' {
  let orientation: number | null = null;
  for (let offset = 2; offset + 3 < bytes.length; ) {
    const segment = jpegSegment(bytes, offset);
    if (segment === null || segment === 'more') return segment;
    const { marker, start, next } = segment;
    if (isStartOfFrame(marker)) {
      const height = uint(bytes, start + 5, 2, false);
      const width = uint(bytes, start + 7, 2, false);
      return (orientation ?? 1) >= 5 ? positive(height, width) : positive(width, height);
    }
    if (marker === 0xe1) orientation ??= exifOrientation(bytes, start + 4, next);
    offset = next;
  }
  return 'more';
}

type JpegSegment = { readonly marker: number; readonly start: number; readonly next: number };

// The marker segment at `offset`, after any fill bytes: null when the bytes
// are not a marker, or end the image or start the scan before any frame
// header; 'more' when the segment runs past the bytes read.
function jpegSegment(bytes: Uint8Array, offset: number): JpegSegment | null | 'more' {
  if (bytes[offset] !== 0xff) return null;
  let start = offset;
  while (bytes[start + 1] === 0xff) start += 1;
  const marker = bytes[start + 1] ?? 0;
  if (marker === 0xd9 || marker === 0xda) return null;
  // Standalone markers carry no length.
  if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
    return { marker, start, next: start + 2 };
  }
  const length = uint(bytes, start + 2, 2, false);
  if (length < 2) return null;
  const next = start + 2 + length;
  return next > bytes.length ? 'more' : { marker, start, next };
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

// The TIFF block after "Exif\0\0", read as Chromium reads it. A block with no
// valid Orientation reads as 1, as stored; an APP1 that is not Exif (XMP) is
// null, so the first Exif segment decides.
function exifOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (!EXIF_IDENTIFIER.every((byte, index) => bytes[start + index] === byte)) return null;
  return exifBlockOrientation(bytes, start + EXIF_IDENTIFIER.length, end) ?? 1;
}

function positive(width: number, height: number): BitmapSize | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function uint(bytes: Uint8Array, offset: number, length: number, little: boolean): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + (little ? length - 1 - index : index)] ?? 0;
    value = value * 256 + byte;
  }
  return value;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
