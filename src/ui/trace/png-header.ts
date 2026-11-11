// PNG header reading for the image loader: the stored size from IHDR and the
// EXIF Orientation of the eXIf chunk. Chromium turns a PNG by its eXIf
// Orientation exactly as it turns a JPEG (ADR-404 Amendment 1), so the loader
// must size a PNG by the turned size too, or the import bounds keep the stored
// aspect while the decoded pixels have the turned one.

import { pngExifOrientation, type ExifOrientation } from '../../io/raster-decode/exif-orientation';
import { readImagePrefix } from './image-header-reader';
import type { ImageDimensions } from './jpeg-header';

export type PngHeader = {
  /** Frame size as encoded, before Orientation is applied. */
  readonly stored: ImageDimensions;
  readonly orientation: ExifOrientation;
  /** The PNG carries an embedded colour profile (iCCP or cICP), or may: a
   *  header that could not be read through to the image data counts. */
  readonly colourProfile: boolean;
};

/**
 * The stored size and Orientation of a PNG, or null when `prefix` (the file's
 * first bytes) is not a PNG. The eXIf chunk may sit beyond the prefix behind
 * a large ICC profile or text chunks; the rest of the file is then read, as
 * the import reads the whole file anyway.
 */
export async function readPngHeader(
  file: Blob,
  prefix: Uint8Array,
  signal?: AbortSignal,
): Promise<PngHeader | null> {
  const stored = parsePngDimensions(prefix);
  if (stored === null) return null;
  let orientation = pngExifOrientation(prefix);
  let colourProfile = pngHasColourProfile(prefix);
  if ((orientation === null || colourProfile === null) && prefix.byteLength < file.size) {
    const whole = await readImagePrefix(file, file.size, signal);
    orientation ??= pngExifOrientation(whole);
    colourProfile ??= pngHasColourProfile(whole);
  }
  return { stored, orientation: orientation ?? 1, colourProfile: colourProfile ?? true };
}

const COLOUR_PROFILE_CHUNKS = new Set(['iCCP', 'cICP']);

/**
 * Whether a colour profile chunk precedes the image data, or null when the
 * bytes end before the image data starts. Chromium converts an embedded
 * profile differently for an <img> drawn on a canvas than for a bitmap decode
 * on some platforms (ADR-357 Amendment 4), so such a PNG keeps the <img>.
 */
export function pngHasColourProfile(bytes: Uint8Array): boolean | null {
  if (bytes.byteLength < 8 || !hasPngSignature(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 8; offset + 8 <= bytes.byteLength; ) {
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (COLOUR_PROFILE_CHUNKS.has(type)) return true;
    if (type === 'IDAT' || type === 'IEND') return false;
    offset += 12 + view.getUint32(offset);
  }
  return null;
}

export function parsePngDimensions(header: Uint8Array): ImageDimensions | null {
  if (header.byteLength < 24 || !hasPngSignature(header)) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const ihdrLength = view.getUint32(8);
  const ihdrType = String.fromCharCode(...header.subarray(12, 16));
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function hasPngSignature(header: Uint8Array): boolean {
  return (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  );
}
