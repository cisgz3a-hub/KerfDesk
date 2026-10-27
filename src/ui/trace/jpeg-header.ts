// JPEG header reading for the image loader: the stored frame size from the
// first start-of-frame segment and the EXIF Orientation tag (0x0112) from an
// APP1 "Exif" segment. Only the bytes before the first scan are examined.
//
// A camera usually stores a portrait photo as a landscape frame and records
// the turn in Orientation. Browsers display and decode the image turned
// (CSS image-orientation: from-image, and createImageBitmap's
// imageOrientation), so every size the loader derives must use the turned
// size or the decode is asked for the wrong aspect ratio. The TIFF block
// inside the APP1 segment is read as Chromium reads it
// (io/raster-decode/exif-orientation.ts); png-header.ts reads a PNG's eXIf.

import {
  exifBlockOrientation,
  type ExifOrientation,
} from '../../io/raster-decode/exif-orientation';

export type { ExifOrientation } from '../../io/raster-decode/exif-orientation';
export type ImageDimensions = { readonly width: number; readonly height: number };

export type JpegHeader = {
  /** Frame size as encoded, before Orientation is applied. */
  readonly stored: ImageDimensions;
  readonly orientation: ExifOrientation;
};

const APP1_MARKER = 0xe1;
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
    // An Orientation entry that is not one SHORT of 1-8 is skipped, as the
    // browser skips it, so the loader never asks for a turned size the
    // browser decoder would not produce.
    const tiff = segment.payloadOffset + EXIF_IDENTIFIER.length;
    return exifBlockOrientation(header, tiff, segment.nextOffset) ?? 1;
  }
  return 1;
}

// image-density.ts walks the same segments and IFD0 for its DPI tags with its
// own loop (jpegDensity/exifDensity); merging the two walkers is a known
// follow-up (ADR-404).
function hasExifIdentifier(header: Uint8Array, offset: number): boolean {
  return EXIF_IDENTIFIER.every((byte, index) => header[offset + index] === byte);
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
