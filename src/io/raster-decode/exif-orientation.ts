// EXIF Orientation, read the way Chromium reads it, for every reader that
// must agree with the browser decode: the image loader (ui/trace/jpeg-header.ts
// and png-header.ts), embedded SVG bitmaps (io/svg/svg-embedded-bitmap-size.ts),
// the streaming PNG import and the headless trace (ADR-404 Amendment 1).
//
// Measured in Chrome 152.0.7977.167 (Skia's SkExif; Electron 44 ships Chromium
// 152.0.7977.130) with JPEG and PNG files built for the purpose:
//  - The TIFF block's header must read II*\0 or MM\0*. IFD0's entries are read
//    in order and the first Orientation entry that is exactly one SHORT of 1-8
//    decides; any other Orientation entry is skipped, not fatal.
//  - When IFD0 holds no valid Orientation, the Exif sub-IFD it points to (tag
//    0x8769, one LONG) is read the same way. Chromium turned a JPEG and a PNG
//    whose only valid Orientation was there.
//  - PNG: only an eXIf chunk before the first IDAT counts. One whose CRC does
//    not match is skipped; the first good one decides, even when it records no
//    Orientation. Its data must be the TIFF block itself: with a JPEG-style
//    "Exif\0\0" prefix Chromium ignores it.
// The eight values are those of the EXIF/TIFF specification: 1 as stored, 2
// mirrored left-right, 3 turned 180 degrees, 4 mirrored top-bottom, and 5-8
// the four cases that swap rows with columns.

import { finishPngCrc, startPngCrc, updatePngCrc } from './png-crc';

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const ORIENTATION_TAG = 0x0112;
const EXIF_SUB_IFD_TAG = 0x8769;
const TIFF_SHORT = 3;
const TIFF_LONG = 4;
const TIFF_MAGIC = 42;
const IFD_ENTRY_BYTES = 12;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EXIF_CHUNK_TYPE = Uint8Array.of(0x65, 0x58, 0x49, 0x66);

type Ifd = { readonly view: DataView; readonly tiff: number; readonly end: number };
type IfdReading = { readonly little: boolean; readonly root: boolean };

/**
 * The Orientation of the TIFF-structured EXIF block in bytes[start, end): a
 * JPEG APP1 payload after its "Exif\0\0", or a PNG eXIf chunk's data. Null
 * when the block is unreadable or records no valid Orientation.
 */
export function exifBlockOrientation(
  bytes: Uint8Array,
  start: number,
  end: number,
): ExifOrientation | null {
  const limit = Math.min(end, bytes.byteLength);
  if (start < 0 || start + 8 > limit) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteOrder = view.getUint16(start, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const little = byteOrder === 0x4949;
  if (view.getUint16(start + 2, little) !== TIFF_MAGIC) return null;
  const ifd = { view, tiff: start, end: limit };
  return ifdOrientation(ifd, view.getUint32(start + 4, little), { little, root: true });
}

// One IFD's entries in order, stopping at the first that runs past the block.
function ifdOrientation(ifd: Ifd, offset: number, reading: IfdReading): ExifOrientation | null {
  const at = ifd.tiff + offset;
  if (offset < 8 || at + 2 > ifd.end) return null;
  const count = ifd.view.getUint16(at, reading.little);
  for (let index = 0; index < count; index += 1) {
    const entry = at + 2 + index * IFD_ENTRY_BYTES;
    if (entry + IFD_ENTRY_BYTES > ifd.end) return null;
    const value = entryOrientation(ifd, entry, reading);
    if (value !== null) return value;
  }
  return null;
}

// A valid Orientation entry's value, or the sub-IFD's when the entry is IFD0's
// pointer to it; null for any other entry.
function entryOrientation(ifd: Ifd, entry: number, reading: IfdReading): ExifOrientation | null {
  const { view } = ifd;
  const { little } = reading;
  const tag = view.getUint16(entry, little);
  const type = view.getUint16(entry + 2, little);
  if (view.getUint32(entry + 4, little) !== 1) return null;
  if (tag === ORIENTATION_TAG && type === TIFF_SHORT) {
    return asOrientation(view.getUint16(entry + 8, little));
  }
  if (!reading.root || tag !== EXIF_SUB_IFD_TAG || type !== TIFF_LONG) return null;
  return ifdOrientation(ifd, view.getUint32(entry + 8, little), { little, root: false });
}

function asOrientation(value: number): ExifOrientation | null {
  return Number.isInteger(value) && value >= 1 && value <= 8 ? (value as ExifOrientation) : null;
}

/**
 * The Orientation of a PNG's first eXIf chunk with a matching CRC before its
 * first IDAT; 1 when there is none, and when the bytes are not a PNG. Null
 * when the bytes end before that is known, so the caller reads more.
 */
export function pngExifOrientation(bytes: Uint8Array): ExifOrientation | null {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = PNG_SIGNATURE.length; ; ) {
    if (offset + 8 > bytes.byteLength) return null;
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT' || type === 'IEND') return 1;
    const next = offset + 12 + length;
    if (type === 'eXIf') {
      if (next > bytes.byteLength) return null;
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      if (pngChunkCrcMatches(data, view.getUint32(offset + 8 + length, false))) {
        return exifBlockOrientation(data, 0, data.byteLength) ?? 1;
      }
    }
    offset = next;
  }
}

function pngChunkCrcMatches(data: Uint8Array, expected: number): boolean {
  return finishPngCrc(updatePngCrc(startPngCrc(EXIF_CHUNK_TYPE), data)) === expected;
}

/** The stored pixel that lands at displayed (x, y), for a stored w x h image. */
export function orientationSourcePixel(
  orientation: ExifOrientation,
  x: number,
  y: number,
  w: number,
  h: number,
): readonly [number, number] {
  switch (orientation) {
    case 2:
      return [w - 1 - x, y];
    case 3:
      return [w - 1 - x, h - 1 - y];
    case 4:
      return [x, h - 1 - y];
    case 5:
      return [y, x];
    case 6:
      return [y, h - 1 - x];
    case 7:
      return [w - 1 - y, h - 1 - x];
    case 8:
      return [w - 1 - y, x];
    case 1:
      return [x, y];
  }
}
