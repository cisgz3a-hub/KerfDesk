// image-density — read an image's embedded physical density (DPI) so an import
// lands at its intended real-world size instead of a hardcoded 96 DPI (P2-A).
// Two common carriers:
//   - PNG `pHYs` chunk: pixels-per-unit X/Y + a unit byte (1 = metre). DPI =
//     pixelsPerMetre * 0.0254.
//   - JPEG JFIF APP0: units (1 = DPI, 2 = dots/cm) + X/Y density. cm -> in is
//     density * 2.54.
// densityFromBytes is a pure parser (unit-tested with inline fixtures);
// readImageDensity is the thin File-reading wrapper. Returns null when no
// supported metadata is present, so the caller falls back to the 96 DPI default.

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

// JPEG JFIF APP0. After SOI (FFD8), segments are [FFxx][len:u16][data]. The JFIF
// APP0 (FFE0) carries: 'JFIF\0' version(2) units(1) Xdensity(2) Ydensity(2)...
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
    if (marker === 0xda || marker === 0xd9) return null; // SOS / EOI — past headers
    if (marker === 0xe0) {
      const density = jfifDensity(view, offset + 4, bytes.length);
      if (density !== null) return density;
    }
    offset += 2 + view.getUint16(offset + 2, false);
  }
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
