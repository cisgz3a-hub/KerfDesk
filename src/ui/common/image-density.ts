// image-density — read an image's embedded physical density (DPI) so an import
// lands at its intended real-world size instead of the default DPI (P2-A).
// Two common carriers:
//   - PNG `pHYs` chunk: pixels-per-unit X/Y + a unit byte (1 = metre). DPI =
//     pixelsPerMetre * 0.0254.
//   - JPEG JFIF APP0: units (1 = DPI, 2 = dots/cm) + X/Y density. cm -> in is
//     density * 2.54.
// densityFromBytes is a pure parser (unit-tested with inline fixtures);
// readImageDensity is the thin File-reading wrapper. Returns null when no
// supported metadata is present, so the caller falls back to the default DPI
// (254, ADR-048).

const MM_NONE = null;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A crafted/corrupt density (e.g. a pHYs of 1-19 px/m rounds to 0 DPI) must be
// treated as absent, not honored: a 0 DPI propagated to Infinity image bounds
// and a NaN transform that silently wrote unloadable .lf2 files and overwrote
// the autosave slot. Anything outside this range is rejected so the caller
// falls back to the default import DPI instead.
const MIN_VALID_DPI = 10;
const MAX_VALID_DPI = 10_000;

export function densityFromBytes(bytes: Uint8Array): number | null {
  const dpi = pngDensity(bytes) ?? jpegDensity(bytes);
  if (dpi === null || dpi < MIN_VALID_DPI || dpi > MAX_VALID_DPI) return null;
  return dpi;
}

export async function readImageDensity(file: File): Promise<number | null> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return densityFromBytes(bytes);
  } catch {
    return MM_NONE;
  }
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// PNG pHYs. Chunks are [len:u32][type:4][data:len][crc:4] after the 8-byte
// signature. pHYs always precedes IDAT, so stop scanning at the first IDAT/IEND.
function pngDensity(bytes: Uint8Array): number | null {
  if (bytes.length < 8) return null;
  const view = viewOf(bytes);
  for (let i = 0; i < 8; i += 1) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) return null;
  }
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = chunkType(view, offset + 4);
    const dataStart = offset + 8;
    if (type === 'pHYs') {
      if (dataStart + 9 > bytes.length) return null;
      const ppuX = view.getUint32(dataStart, false);
      const unit = view.getUint8(dataStart + 8);
      // unit 1 = metre; 0 = unitless aspect ratio (no real DPI).
      return unit === 1 && ppuX > 0 ? Math.round(ppuX * 0.0254) : null;
    }
    if (type === 'IDAT' || type === 'IEND') return null;
    offset = dataStart + length + 4;
  }
  return null;
}

function chunkType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

// JPEG. After SOI (FFD8), segments are [FFxx][len:u16][data]. Density lives in
// either the JFIF APP0 (FFE0) density fields or — for camera/scanner files that
// often carry no JFIF at all — the EXIF APP1 (FFE1) TIFF IFD (XResolution +
// ResolutionUnit). 0xFF fill bytes can pad between segments; skip them rather
// than mis-reading one as a marker with a garbage length.
function jpegDensity(bytes: Uint8Array): number | null {
  if (bytes.length < 4) return null;
  const view = viewOf(bytes);
  if (view.getUint8(0) !== 0xff || view.getUint8(1) !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset += 1; // fill padding — not a real marker
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return null; // SOS / EOI — past headers
    const density = segmentDensity(marker, view, offset + 4, bytes.length);
    if (density !== null) return density;
    offset += 2 + view.getUint16(offset + 2, false);
  }
  return null;
}

function segmentDensity(
  marker: number,
  view: DataView,
  dataStart: number,
  byteLength: number,
): number | null {
  if (marker === 0xe0) return jfifDensity(view, dataStart, byteLength);
  if (marker === 0xe1) return exifDensity(view, dataStart, byteLength);
  return null;
}

// Extract DPI from a JFIF APP0 segment body (kept separate so jpegDensity stays
// under the complexity cap). units 1 = DPI, 2 = dots/cm, 0 = aspect-ratio only.
function jfifDensity(view: DataView, dataStart: number, byteLength: number): number | null {
  if (dataStart + 12 > byteLength || !isJfif(view, dataStart)) return null;
  const units = view.getUint8(dataStart + 7);
  const xDensity = view.getUint16(dataStart + 8, false);
  if (xDensity <= 0) return null;
  if (units === 1) return xDensity;
  if (units === 2) return Math.round(xDensity * 2.54);
  return null;
}

function isJfif(view: DataView, o: number): boolean {
  return (
    view.getUint8(o) === 0x4a && // J
    view.getUint8(o + 1) === 0x46 && // F
    view.getUint8(o + 2) === 0x49 && // I
    view.getUint8(o + 3) === 0x46 && // F
    view.getUint8(o + 4) === 0x00
  );
}

// EXIF APP1: 'Exif\0\0' then a TIFF block (byte-order header + IFD0). DPI comes
// from XResolution (tag 0x011A, RATIONAL) scaled by ResolutionUnit (tag 0x0128:
// 2 = inch, 3 = cm). Endianness is per-file ('II' little, 'MM' big).
function exifDensity(view: DataView, dataStart: number, byteLength: number): number | null {
  if (dataStart + 8 > byteLength || !isExif(view, dataStart)) return null;
  const tiff = dataStart + 6;
  const little = view.getUint16(tiff, false) === 0x4949; // 'II' = little-endian
  if (view.getUint16(tiff + 2, little) !== 0x2a) return null; // TIFF magic
  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (ifd0 + 2 > byteLength) return null;
  return resolutionFromIfd(view, tiff, ifd0, little, byteLength);
}

function isExif(view: DataView, o: number): boolean {
  return (
    view.getUint8(o) === 0x45 && // E
    view.getUint8(o + 1) === 0x78 && // x
    view.getUint8(o + 2) === 0x69 && // i
    view.getUint8(o + 3) === 0x66 && // f
    view.getUint8(o + 4) === 0x00 &&
    view.getUint8(o + 5) === 0x00
  );
}

function resolutionFromIfd(
  view: DataView,
  tiff: number,
  ifd0: number,
  little: boolean,
  byteLength: number,
): number | null {
  const count = view.getUint16(ifd0, little);
  let xRes: number | null = null;
  let unit = 2; // EXIF default = inches
  for (let i = 0; i < count; i += 1) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > byteLength) break;
    const tag = view.getUint16(entry, little);
    if (tag === 0x011a) {
      xRes = rationalAt(view, tiff + view.getUint32(entry + 8, little), little, byteLength);
    } else if (tag === 0x0128) {
      unit = view.getUint16(entry + 8, little);
    }
  }
  if (xRes === null || xRes <= 0) return null;
  return unit === 3 ? Math.round(xRes * 2.54) : Math.round(xRes);
}

function rationalAt(
  view: DataView,
  offset: number,
  little: boolean,
  byteLength: number,
): number | null {
  if (offset + 8 > byteLength) return null;
  const numerator = view.getUint32(offset, little);
  const denominator = view.getUint32(offset + 4, little);
  return denominator === 0 ? null : numerator / denominator;
}
