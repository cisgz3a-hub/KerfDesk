/**
 * T2-124: pre-decode size + pixel limits for image imports
 * (decompression bomb protection). Pre-T2-124 the import flow
 * read the file fully and decoded fully before any pixel-count
 * check ran — a 50000×50000 PNG of one colour compresses to ~1MB
 * but decodes to 10GB, crashing the renderer or freezing the UI.
 *
 * Audit 5D Critical 8 + Required Priority 8. T2-124 ships the
 * limits + check helpers + a typed error; wiring them into
 * `useImport.ts` so the order of operations becomes file-size
 * check → header probe → pixel-cap check → full decode is filed
 * as T2-124-followup so the change to the import flow lands as
 * a coupled diff with its own UI tests.
 */

export const IMAGE_LIMITS = {
  /** Maximum file bytes — catches the easy "5GB BMP" case. */
  MAX_FILE_BYTES: 50 * 1024 * 1024,
  /** Maximum decoded pixels — ~7100×7100. The key bomb-protection cap. */
  MAX_PIXELS: 50_000_000,
  /** Maximum width OR height alone, even when the area fits. */
  MAX_DIMENSION: 16_384,
} as const;

export type ImageLimitKey = keyof typeof IMAGE_LIMITS;

export type ImageHeaderFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

export interface ImageHeaderDimensions {
  width: number;
  height: number;
  format: ImageHeaderFormat;
}

const IMAGE_HEADER_PROBE_BYTES = 64 * 1024;

/**
 * Specific error thrown by the import path when a limit trips.
 * Carries the limit name + observed value + maximum so the UI can
 * render an informative message ("Image too large: 50000×50000 = 2500M
 * pixels. Maximum: 50 megapixels.").
 */
export class ImageImportLimitError extends Error {
  override readonly name = 'ImageImportLimitError';
  readonly limit: ImageLimitKey;
  readonly observed: number;
  readonly maximum: number;
  /** When the failure was on dimensions, capture both. */
  readonly width?: number;
  readonly height?: number;

  constructor(
    limit: ImageLimitKey,
    observed: number,
    extras?: { width?: number; height?: number },
  ) {
    super(`Image ${limit} exceeded: observed ${observed}, limit ${IMAGE_LIMITS[limit]}`);
    this.limit = limit;
    this.observed = observed;
    this.maximum = IMAGE_LIMITS[limit];
    this.width = extras?.width;
    this.height = extras?.height;
    Object.setPrototypeOf(this, ImageImportLimitError.prototype);
  }
}

/**
 * Stage 1: file-size check. Throws when bytes > MAX_FILE_BYTES.
 * Run BEFORE reading the file — for File objects, `.size` is free.
 */
export function checkImageFileSize(bytes: number): void {
  if (bytes > IMAGE_LIMITS.MAX_FILE_BYTES) {
    throw new ImageImportLimitError('MAX_FILE_BYTES', bytes);
  }
}

/**
 * Stage 2: post-header pixel-count check. Throws when:
 * - either dimension exceeds MAX_DIMENSION, OR
 * - the total pixel count exceeds MAX_PIXELS.
 *
 * Run AFTER getting `width × height` from a header probe (PNG IHDR,
 * JPEG SOF, or `createImageBitmap` followed by close()), and BEFORE
 * the full decode used for rendering.
 */
export function checkImageDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height)
      || width < 0 || height < 0) {
    throw new ImageImportLimitError('MAX_DIMENSION', Math.max(width, height) || 0,
      { width, height });
  }
  if (width > IMAGE_LIMITS.MAX_DIMENSION) {
    throw new ImageImportLimitError('MAX_DIMENSION', width, { width, height });
  }
  if (height > IMAGE_LIMITS.MAX_DIMENSION) {
    throw new ImageImportLimitError('MAX_DIMENSION', height, { width, height });
  }
  const totalPixels = width * height;
  if (totalPixels > IMAGE_LIMITS.MAX_PIXELS) {
    throw new ImageImportLimitError('MAX_PIXELS', totalPixels, { width, height });
  }
}

function matchesBytes(view: DataView, start: number, bytes: readonly number[]): boolean {
  if (view.byteLength < start + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (view.getUint8(start + i) !== bytes[i]) return false;
  }
  return true;
}

function ascii(view: DataView, start: number, length: number): string {
  if (view.byteLength < start + length) return '';
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(start + i));
  return out;
}

function u24le(view: DataView, offset: number): number {
  return view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16);
}

function validDimensions(width: number, height: number, format: ImageHeaderFormat): ImageHeaderDimensions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height, format };
}

function parsePngHeader(view: DataView): ImageHeaderDimensions | null {
  const pngSig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!matchesBytes(view, 0, pngSig) || ascii(view, 12, 4) !== 'IHDR' || view.byteLength < 24) return null;
  return validDimensions(view.getUint32(16, false), view.getUint32(20, false), 'png');
}

function parseGifHeader(view: DataView): ImageHeaderDimensions | null {
  const sig = ascii(view, 0, 6);
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  if (view.byteLength < 10) return null;
  return validDimensions(view.getUint16(6, true), view.getUint16(8, true), 'gif');
}

function parseBmpHeader(view: DataView): ImageHeaderDimensions | null {
  if (ascii(view, 0, 2) !== 'BM' || view.byteLength < 26) return null;
  const dibSize = view.getUint32(14, true);
  if (dibSize === 12 && view.byteLength >= 22) {
    return validDimensions(view.getUint16(18, true), view.getUint16(20, true), 'bmp');
  }
  if (dibSize >= 40) {
    return validDimensions(Math.abs(view.getInt32(18, true)), Math.abs(view.getInt32(22, true)), 'bmp');
  }
  return null;
}

function parseWebpHeader(view: DataView): ImageHeaderDimensions | null {
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WEBP' || view.byteLength < 30) return null;
  const chunk = ascii(view, 12, 4);
  if (chunk === 'VP8X') {
    return validDimensions(1 + u24le(view, 24), 1 + u24le(view, 27), 'webp');
  }
  if (chunk === 'VP8L' && view.getUint8(20) === 0x2f) {
    const b0 = view.getUint8(21);
    const b1 = view.getUint8(22);
    const b2 = view.getUint8(23);
    const b3 = view.getUint8(24);
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return validDimensions(width, height, 'webp');
  }
  if (chunk === 'VP8 ') {
    const dataOffset = 20;
    if (
      view.getUint8(dataOffset + 3) === 0x9d &&
      view.getUint8(dataOffset + 4) === 0x01 &&
      view.getUint8(dataOffset + 5) === 0x2a
    ) {
      const width = view.getUint16(dataOffset + 6, true) & 0x3fff;
      const height = view.getUint16(dataOffset + 8, true) & 0x3fff;
      return validDimensions(width, height, 'webp');
    }
  }
  return null;
}

function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function parseJpegHeader(view: DataView): ImageHeaderDimensions | null {
  if (!matchesBytes(view, 0, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 3 < view.byteLength) {
    while (offset < view.byteLength && view.getUint8(offset) !== 0xff) offset++;
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
    if (offset >= view.byteLength) break;

    const marker = view.getUint8(offset++);
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > view.byteLength) break;

    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2) break;
    const segmentStart = offset + 2;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > view.byteLength) break;

    if (isJpegSofMarker(marker) && segmentStart + 5 <= segmentEnd) {
      const height = view.getUint16(segmentStart + 1, false);
      const width = view.getUint16(segmentStart + 3, false);
      return validDimensions(width, height, 'jpeg');
    }
    offset = segmentEnd;
  }
  return null;
}

/**
 * S25-02-001: read dimensions from image headers before any bitmap or
 * canvas decode path. Returns null for unknown/unsupported headers so callers
 * can fall back to post-decode checks, but common raster formats are gated
 * before memory-heavy decode.
 */
export async function probeImageHeaderDimensions(source: Blob): Promise<ImageHeaderDimensions | null> {
  const headerBlob = typeof source.slice === 'function'
    ? source.slice(0, IMAGE_HEADER_PROBE_BYTES)
    : source;
  const view = new DataView(await headerBlob.arrayBuffer());
  return (
    parsePngHeader(view) ??
    parseJpegHeader(view) ??
    parseGifHeader(view) ??
    parseWebpHeader(view) ??
    parseBmpHeader(view)
  );
}

/**
 * User-facing message for an `ImageImportLimitError`. Mirrors the
 * audit's wording — "Image too large: WIDTH×HEIGHT = N megapixels.
 * Maximum: M megapixels." Returns a fallback for unknown errors.
 */
export function imageLimitErrorMessage(err: unknown): string {
  if (!(err instanceof ImageImportLimitError)) {
    return 'Cannot import image: an unexpected error occurred while reading the file.';
  }
  switch (err.limit) {
    case 'MAX_FILE_BYTES': {
      const mb = (err.observed / 1024 / 1024).toFixed(1);
      const maxMb = (err.maximum / 1024 / 1024).toFixed(0);
      return `Image file too large: ${mb} MB. The maximum supported is ${maxMb} MB.`;
    }
    case 'MAX_PIXELS': {
      const observedMp = (err.observed / 1_000_000).toFixed(1);
      const maxMp = (err.maximum / 1_000_000).toFixed(0);
      const dims = err.width != null && err.height != null
        ? `${err.width}×${err.height} = `
        : '';
      return `Image too large: ${dims}${observedMp}M pixels. The maximum supported is ${maxMp} megapixels.`;
    }
    case 'MAX_DIMENSION': {
      const dims = err.width != null && err.height != null
        ? ` (${err.width}×${err.height})`
        : '';
      return `Image dimension too large${dims}: a side of ${err.observed.toLocaleString()} pixels exceeds the maximum of ${err.maximum.toLocaleString()}.`;
    }
  }
}

/**
 * Convenience for the import path: run the full pre-decode check
 * pipeline. Throws the first ImageImportLimitError that fires, or
 * returns the dimensions back to the caller for the post-decode step.
 */
export function checkImageBeforeDecode(args: {
  fileBytes: number;
  width: number;
  height: number;
}): { width: number; height: number; pixels: number } {
  checkImageFileSize(args.fileBytes);
  checkImageDimensions(args.width, args.height);
  return {
    width: args.width,
    height: args.height,
    pixels: args.width * args.height,
  };
}
