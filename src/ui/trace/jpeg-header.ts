// JPEG header reading for the image loader: the stored frame size from the
// first start-of-frame segment and the EXIF Orientation tag (0x0112) from an
// APP1 "Exif" segment. Only the bytes before the first scan are examined.
//
// A camera usually stores a portrait photo as a landscape frame and records
// the turn in Orientation. Browsers display and decode the image turned
// (CSS image-orientation: from-image, and createImageBitmap's
// imageOrientation), so every size the loader derives must use the turned
// size or the decode is asked for the wrong aspect ratio. The eight values
// are those of the EXIF/TIFF specification: 1 as stored, 2 mirrored
// left-right, 3 turned 180 degrees, 4 mirrored top-bottom, and 5-8 the four
// cases that swap rows with columns.

export type ImageDimensions = { readonly width: number; readonly height: number };
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type JpegHeader = {
  /** Frame size as encoded, before Orientation is applied. */
  readonly stored: ImageDimensions;
  readonly orientation: ExifOrientation;
};

const APP1_MARKER = 0xe1;
const ORIENTATION_TAG = 0x0112;
const TIFF_SHORT = 3;
const TIFF_MAGIC = 42;
const IFD_ENTRY_BYTES = 12;
// "Exif\0\0" precedes the TIFF block inside APP1.
const EXIF_IDENTIFIER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

export function parseJpegHeader(header: Uint8Array): JpegHeader | null {
  if (!hasJpegSignature(header)) return null;
  const segments = readJpegSegments(header);
  const frame = segments.find((segment) => isJpegStartOfFrameMarker(segment.marker));
  if (frame === undefined) return null;
  const stored = readJpegStartOfFrameDimensions(header, frame.payloadOffset);
  if (stored === null) return null;
  return { stored, orientation: orientationFromSegments(header, segments) };
}

/** EXIF Orientation of a JPEG header; 1 (as stored) when absent or invalid. */
export function jpegExifOrientation(header: Uint8Array): ExifOrientation {
  if (!hasJpegSignature(header)) return 1;
  return orientationFromSegments(header, readJpegSegments(header));
}

/** Orientations 5-8 swap rows and columns: the displayed width is the stored height. */
export function orientationSwapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5;
}

export function orientedDimensions(
  stored: ImageDimensions,
  orientation: ExifOrientation,
): ImageDimensions {
  return orientationSwapsAxes(orientation)
    ? { width: stored.height, height: stored.width }
    : stored;
}

/**
 * The setTransform matrix [a, b, c, d, e, f] that draws a stored-orientation
 * image, filling the canvas once turned, upright into a canvas of
 * canvasWidth x canvasHeight. The image is drawn at the origin with its
 * stored axes: canvasHeight x canvasWidth when the orientation swaps axes.
 */
export function orientationCanvasTransform(
  orientation: ExifOrientation,
  canvasWidth: number,
  canvasHeight: number,
): readonly [number, number, number, number, number, number] {
  const w = canvasWidth;
  const h = canvasHeight;
  switch (orientation) {
    case 1:
      return [1, 0, 0, 1, 0, 0];
    case 2:
      return [-1, 0, 0, 1, w, 0];
    case 3:
      return [-1, 0, 0, -1, w, h];
    case 4:
      return [1, 0, 0, -1, 0, h];
    case 5:
      return [0, 1, 1, 0, 0, 0];
    case 6:
      return [0, 1, -1, 0, w, 0];
    case 7:
      return [0, -1, -1, 0, w, h];
    case 8:
      return [0, -1, 1, 0, 0, h];
  }
}

function orientationFromSegments(
  header: Uint8Array,
  segments: ReadonlyArray<JpegSegment>,
): ExifOrientation {
  for (const segment of segments) {
    if (segment.marker !== APP1_MARKER || !hasExifIdentifier(header, segment.payloadOffset)) {
      continue;
    }
    // The first Exif APP1 is authoritative; an XMP APP1 never carries it.
    return readExifOrientation(header, segment) ?? 1;
  }
  return 1;
}

function hasExifIdentifier(header: Uint8Array, offset: number): boolean {
  return EXIF_IDENTIFIER.every((byte, index) => header[offset + index] === byte);
}

// IFD0 of the TIFF block: a count, then 12-byte entries of tag, type, count
// and a 4-byte value field that holds a SHORT in its first two bytes.
function readExifOrientation(header: Uint8Array, segment: JpegSegment): ExifOrientation | null {
  const end = Math.min(segment.nextOffset, header.byteLength);
  const tiff = segment.payloadOffset + EXIF_IDENTIFIER.length;
  if (tiff + 8 > end) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const byteOrder = view.getUint16(tiff, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null;
  const little = byteOrder === 0x4949;
  if (view.getUint16(tiff + 2, little) !== TIFF_MAGIC) return null;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd < tiff + 8 || ifd + 2 > end) return null;
  const count = view.getUint16(ifd, little);
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * IFD_ENTRY_BYTES;
    if (entry + IFD_ENTRY_BYTES > end) return null;
    if (view.getUint16(entry, little) !== ORIENTATION_TAG) continue;
    if (view.getUint16(entry + 2, little) !== TIFF_SHORT) return null;
    return asOrientation(view.getUint16(entry + 8, little));
  }
  return null;
}

function asOrientation(value: number): ExifOrientation | null {
  return Number.isInteger(value) && value >= 1 && value <= 8 ? (value as ExifOrientation) : null;
}

type JpegSegment = {
  readonly marker: number;
  readonly payloadOffset: number;
  readonly nextOffset: number;
};

function hasJpegSignature(header: Uint8Array): boolean {
  return header.byteLength >= 4 && header[0] === 0xff && header[1] === 0xd8;
}

function readJpegSegments(header: Uint8Array): ReadonlyArray<JpegSegment> {
  const segments: JpegSegment[] = [];
  let offset = 2;
  while (offset + 3 < header.byteLength) {
    const next = readNextJpegSegment(header, offset);
    if (next === null) break;
    offset = next.nextOffset;
    if (next.marker === null) continue;
    segments.push(next);
  }
  return segments;
}

function readNextJpegSegment(
  header: Uint8Array,
  offset: number,
):
  | (JpegSegment & { readonly marker: number })
  | { readonly marker: null; readonly nextOffset: number }
  | null {
  if (header[offset] !== 0xff) return { marker: null, nextOffset: offset + 1 };
  const markerOffset = skipJpegMarkerFillBytes(header, offset);
  const marker = header[markerOffset] ?? 0;
  const lengthOffset = markerOffset + 1;
  if (marker === 0xd9 || marker === 0xda) return null;
  if (isStandaloneJpegMarker(marker)) return { marker: null, nextOffset: lengthOffset };
  if (lengthOffset + 1 >= header.byteLength) return null;

  const segmentLength = ((header[lengthOffset] ?? 0) << 8) | (header[lengthOffset + 1] ?? 0);
  if (segmentLength < 2) return null;
  return {
    marker,
    payloadOffset: lengthOffset + 2,
    nextOffset: lengthOffset + segmentLength,
  };
}

function skipJpegMarkerFillBytes(header: Uint8Array, offset: number): number {
  let markerOffset = offset;
  while (markerOffset < header.byteLength && header[markerOffset] === 0xff) {
    markerOffset += 1;
  }
  return markerOffset;
}

function readJpegStartOfFrameDimensions(
  header: Uint8Array,
  payloadOffset: number,
): ImageDimensions | null {
  if (payloadOffset + 4 >= header.byteLength) return null;
  const height = ((header[payloadOffset + 1] ?? 0) << 8) | (header[payloadOffset + 2] ?? 0);
  const width = ((header[payloadOffset + 3] ?? 0) << 8) | (header[payloadOffset + 4] ?? 0);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function isStandaloneJpegMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);
}

function isJpegStartOfFrameMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}
