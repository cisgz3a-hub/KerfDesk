// Stored composite sections from Adobe's PSD specification. Layer pixels and
// effects are deliberately not parsed or recomposited (ADR-591).
import { assertRasterSize } from '../raster-decode/decoded-raster';

export type PsdHeader = {
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly colorMode: 1 | 3;
};
export type PsdComposite = PsdHeader & {
  readonly compression: 0 | 1;
  readonly offset: number;
  readonly hasMergedAlpha: boolean;
  readonly dpi: { readonly x: number; readonly y: number } | null;
  readonly hasColorProfile: boolean;
};

// The embedded PSD route retains decoded RGBA, optional alpha, sampled pixels,
// canvas/ImageData, PNG bytes and base64 strings. Reserve 64 bytes per source
// pixel plus two source-file copies within a 512 MiB working-allocation budget.
// This is this decoder/encoder's budget, not a browser canvas dimension claim.
const PSD_WORKING_BYTES = 512 * 1024 * 1024;
const PSD_BYTES_PER_PIXEL = 64;

export function readPsdHeader(bytes: Uint8Array, sourceBytes = bytes.byteLength): PsdHeader {
  const view = viewOf(bytes);
  requireBytes(view, 0, 26);
  if (view.getUint32(0) !== 0x38425053) throw new Error('This file is not a Photoshop PSD.');
  if (view.getUint16(4) !== 1) {
    throw new Error('PSB large documents are not supported. Save an 8-bit RGB or grayscale PSD.');
  }
  const channels = view.getUint16(12);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  assertRasterSize(width, height);
  // This embedded route encodes its full source using the same 16384-edge
  // Chromium canvas boundary as the existing PNG/TIFF import routes.
  if (width > 16384 || height > 16384) {
    throw new Error('PSD dimensions exceed the embedded image canvas. Resize or export a PNG.');
  }
  assertPsdWorkingSize(width, height, sourceBytes);
  if (view.getUint16(22) !== 8)
    throw new Error('PSD import supports 8-bit samples. Export an 8-bit RGB or grayscale copy.');
  const colorMode = view.getUint16(24);
  if (colorMode !== 1 && colorMode !== 3) {
    throw new Error('PSD import supports RGB and grayscale. Convert this document to RGB first.');
  }
  const base = colorMode === 1 ? 1 : 3;
  if (channels < base || channels > base + 1) {
    throw new Error(
      'PSD channel layout is unsupported. Export an RGB or grayscale copy without extra channels.',
    );
  }
  return { width, height, channels, colorMode };
}

function assertPsdWorkingSize(width: number, height: number, sourceBytes: number): void {
  if (width * height * PSD_BYTES_PER_PIXEL + sourceBytes * 2 > PSD_WORKING_BYTES) {
    throw new Error(
      "PSD composite exceeds this importer's memory budget. Resize the document or export PNG.",
    );
  }
}

export function inspectPsdComposite(bytes: Uint8Array): PsdComposite {
  const header = readPsdHeader(bytes);
  const view = viewOf(bytes);
  const color = section(view, 26);
  const resources = section(view, color.end);
  const metadata = readResources(view, resources.start, resources.end);
  const layers = section(view, resources.end);
  const hasMergedAlpha = mergedAlpha(view, layers.start, layers.end);
  const base = header.colorMode === 1 ? 1 : 3;
  if (hasMergedAlpha && header.channels !== base + 1) {
    throw new Error('PSD declares merged transparency but its alpha channel is missing.');
  }
  const offset = layers.end;
  if (offset + 2 >= bytes.length)
    throw new Error(
      'PSD has no stored composite image. Save with Maximize Compatibility or export PNG.',
    );
  const compression = view.getUint16(offset);
  if (compression !== 0 && compression !== 1) {
    throw new Error(
      'ZIP-compressed PSD composites are not supported. Save a raw/RLE PSD or export PNG.',
    );
  }
  validatePixels(view, offset + 2, header, compression);
  return { ...header, compression, offset, hasMergedAlpha, ...metadata };
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
function requireBytes(view: DataView, start: number, length: number): void {
  if (start < 0 || length < 0 || start + length > view.byteLength)
    throw new Error('PSD data is incomplete or has an invalid section length.');
}
function section(view: DataView, offset: number): { start: number; end: number } {
  requireBytes(view, offset, 4);
  const start = offset + 4;
  const length = view.getUint32(offset);
  requireBytes(view, start, length);
  return { start, end: start + length };
}
function mergedAlpha(view: DataView, start: number, end: number): boolean {
  if (start === end) return false;
  const layers = section(view, start);
  if (layers.end > end) throw new Error('PSD layer section exceeds its declared size.');
  if (layers.start === layers.end) return false;
  if (layers.end - layers.start < 2) throw new Error('PSD layer count is incomplete.');
  return view.getInt16(layers.start) < 0;
}

function readResources(
  view: DataView,
  start: number,
  end: number,
): Pick<PsdComposite, 'dpi' | 'hasColorProfile'> {
  let density: PsdComposite['dpi'] = null;
  let hasColorProfile = false;
  while (start < end) {
    requireBytes(view, start, 7);
    // The same resource signatures accepted by the pinned ag-psd reader.
    if (
      ![0x3842494d, 0x4d655361, 0x41674867, 0x50485554, 0x44435352].includes(view.getUint32(start))
    )
      throw new Error('PSD image resource signature is invalid.');
    const id = view.getUint16(start + 4);
    const nameBytes = view.getUint8(start + 6) + 1;
    const sizeOffset = start + 6 + nameBytes + (nameBytes % 2);
    const resource = section(view, sizeOffset);
    const next = resource.end + ((resource.end - resource.start) % 2);
    if (next > end) throw new Error('PSD image resource exceeds its declared size.');
    if (id === 1005) density = resolution(view, resource.start, resource.end);
    if (id === 1039) hasColorProfile = true;
    if (id === 1057 && resource.end - resource.start < 5)
      throw new Error('PSD merged preview metadata is incomplete.');
    if (
      id === 1057 &&
      resource.end - resource.start >= 5 &&
      view.getUint8(resource.start + 4) === 0
    ) {
      throw new Error(
        'PSD has no real merged preview. Save with Maximize Compatibility or export PNG.',
      );
    }
    start = next;
  }
  return { dpi: density, hasColorProfile };
}
function resolution(view: DataView, start: number, end: number): PsdComposite['dpi'] {
  if (end - start < 16) throw new Error('PSD resolution metadata is incomplete.');
  const x = dpiAxis(view.getUint32(start) / 65536, view.getUint16(start + 4));
  const y = dpiAxis(view.getUint32(start + 8) / 65536, view.getUint16(start + 12));
  return x === null || y === null ? null : { x, y };
}
function dpiAxis(value: number, unit: number): number | null {
  if (unit !== 1 && unit !== 2) return null;
  // Adobe ResolutionInfo always stores pixels/inch. The unit controls how
  // Photoshop displays resolution (PPI/PPCM), not the fixed-point value.
  return value >= 10 && value <= 10000 ? value : null;
}

function validatePixels(
  view: DataView,
  offset: number,
  header: PsdHeader,
  compression: 0 | 1,
): void {
  const { width, height, channels } = header;
  if (compression === 0) {
    requireBytes(view, offset, width * height * channels);
    return;
  }
  const rows = height * channels;
  requireBytes(view, offset, rows * 2);
  let start = offset + rows * 2;
  for (let row = 0; row < rows; row += 1) {
    const length = view.getUint16(offset + row * 2);
    requireBytes(view, start, length);
    validateRleRow(view, start, start + length, width);
    start += length;
  }
}
function validateRleRow(view: DataView, start: number, end: number, width: number): void {
  let pixels = 0;
  while (start < end) {
    const control = view.getUint8(start++);
    if (control === 128) continue;
    const count = control < 128 ? control + 1 : 257 - control;
    start += control < 128 ? count : 1;
    pixels += count;
    if (start > end || pixels > width)
      throw new Error('PSD composite contains an invalid RLE row.');
  }
  if (pixels !== width) throw new Error('PSD composite RLE row is incomplete.');
}
