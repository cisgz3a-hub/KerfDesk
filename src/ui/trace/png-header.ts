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
  const orientation =
    pngExifOrientation(prefix) ??
    (prefix.byteLength < file.size
      ? pngExifOrientation(await readImagePrefix(file, file.size, signal))
      : null) ??
    1;
  return { stored, orientation };
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
