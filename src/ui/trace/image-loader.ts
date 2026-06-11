// Phase E image loader — decodes a PNG/JPG file into ImageData
// suitable for traceImageToSvgString.
//
// Browser-only: uses an offscreen canvas to rasterize the image and
// pull its pixel buffer. Caller (ImportImageDialog) holds the File
// blob and awaits this loader before kicking off tracing.

import type { RawImageData } from '../../core/trace';

// Cap on the longest image edge after decode, in pixels. Two competing
// forces: trace runtime is O(width × height × colors) (imagetracerjs and
// potrace both), so an unbounded decode makes tracing a large photo crawl;
// but a cap that is too LOW throws away the resolution small features —
// especially small TEXT — need, so they trace as faceted, wavy curves: the
// "langebaan" small-text defect (docs/research/burn-perfection-small-text.md
// Cause B; ADR-037). 2048 (was 1024) doubles the linear resolution — 4× the
// pixels, ~4× the trace time — recovering small-feature fidelity while staying
// interactive on modest hardware in the trace Worker.
//
// RAISING this is registration- and size-safe: source.pixelWidth tracks the
// same sampled size (image-import.ts) and the overlaid trace's mm size is
// traceCoord/pixelWidth × widthMm — invariant to the cap (widthMm comes from
// the NATURAL size at the import DPI, not the sample). Only detail density changes.
// We intentionally do NOT upscale BELOW the source's own size: bilinear-
// upscaling deliberate pixel art (the Sharp preset) would blur the very
// notches the user wants kept. Larger inputs are downsampled proportionally.
const MAX_EDGE_PX = 2048;
// Preview and commit use the same cap so the dialog does not preview one
// pixel grid and then commit a different trace.
export const PREVIEW_MAX_EDGE_PX = MAX_EDGE_PX;

const PAPER_WHITE = 255;

export async function loadImageAsRawData(
  file: File,
  maxEdge: number = MAX_EDGE_PX,
): Promise<RawImageData> {
  // The try/finally pairing around createObjectURL + revokeObjectURL is
  // load-bearing: each createObjectURL allocation pins the underlying
  // Blob in memory until revokeObjectURL is called or the document is
  // torn down. A future refactor that swaps the try/finally for a bare
  // try/catch (or moves the decode out of the same function) would leak
  // the Blob on every import. Keep them in lockstep. R-L3 audit note.
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    const { width, height } = scaleToCap(img.width, img.height, maxEdge);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      throw new Error('Could not create 2D canvas context for image decoding.');
    }
    ctx.drawImage(img, 0, 0, width, height);
    const imgd = ctx.getImageData(0, 0, width, height);
    return compositeRgbOverWhitePreservingAlpha({
      width: imgd.width,
      height: imgd.height,
      data: imgd.data,
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function compositeRgbOverWhitePreservingAlpha(image: RawImageData): RawImageData {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] ?? 255;
    const opacity = alpha / 255;
    data[i] = compositeChannel(image.data[i], opacity);
    data[i + 1] = compositeChannel(image.data[i + 1], opacity);
    data[i + 2] = compositeChannel(image.data[i + 2], opacity);
    data[i + 3] = alpha;
  }
  return { width: image.width, height: image.height, data };
}

function compositeChannel(value: number | undefined, opacity: number): number {
  const source = value ?? 0;
  return Math.round(source * opacity + PAPER_WHITE * (1 - opacity));
}

export async function readImageNaturalSize(
  file: File,
): Promise<{ readonly width: number; readonly height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    return { width: img.width, height: img.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void => reject(new Error('Failed to decode image — unsupported format?'));
    img.src = url;
  });
}

// Exported for unit testing the cap math directly (decodeImage needs a real
// browser canvas, so the cap behaviour is verified here as a pure function).
export function scaleToCap(
  width: number,
  height: number,
  cap: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= cap) return { width, height };
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// F.2.e: extract a luma buffer (one byte per pixel, ITU-R BT.601)
// from RGBA image data, then base64-encode it for JSON transit.
// Used by the Add Image flow so compile-job can dither pure-core
// from RasterImage.lumaBase64 without touching the DOM.
export function extractLumaBase64(image: RawImageData): string {
  const pixelCount = image.width * image.height;
  const buf = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const r = image.data[i * 4] ?? 0;
    const g = image.data[i * 4 + 1] ?? 0;
    const b = image.data[i * 4 + 2] ?? 0;
    buf[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  // btoa wants a "binary string" (each char's code point = byte). One char
  // per byte rather than String.fromCharCode(...buf) because the spread
  // form hits V8's argument-count limit at ~64K pixels (LU10: an earlier
  // comment claimed chunking that never existed — this loop is O(n) appends,
  // not chunked, and that is fine).
  let bin = '';
  for (const v of buf) {
    bin += String.fromCharCode(v);
  }
  return btoa(bin);
}

// Read a File's bytes as a base64 data URL ('data:image/png;base64,…').
// Distinct from loadImageAsRawData: this preserves the ORIGINAL bytes —
// no decode, no downscale — so the stored bitmap is full quality. Used by
// the Import Image flow (Toolbar) to embed the source image in the .lf2
// project (ADR-020); that same stored dataUrl is what the Trace tool later
// reconstructs (dataUrlToFile, below) to overlay a vector trace on the
// already-imported bitmap (ADR-026, unified image flow).
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      // Fail at the read boundary instead of resolving '' — an empty data URL
      // would be stored as the project's image and silently engrave nothing
      // (P2-A). A non-string result here means the read did not produce a data
      // URL, which is an error, not an empty image.
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader returned a non-string result for the image.'));
      }
    };
    reader.onerror = (): void => reject(new Error('FileReader failed to read the image.'));
    reader.readAsDataURL(file);
  });
}

// Reconstruct a File from a stored data URL. The unified image flow
// (LightBurn model) imports a bitmap first, then runs Trace as a tool on
// that already-imported RasterImage — but the trace preview + commit
// pipeline (useTracePreview, loadImageAsRawData) is keyed on a File. Round-
// tripping the RasterImage's embedded dataUrl back into a File lets the
// trace tool reuse that pipeline unchanged instead of forking it to accept
// raw pixels. Do not use fetch(dataUrl) here: production CSP's connect-src
// intentionally blocks data: fetches, while Vite dev has no matching
// Cloudflare header.
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const { mimeType, bytes } = decodeDataUrl(dataUrl);
  return new File([toArrayBuffer(bytes)], filename, { type: mimeType });
}

function decodeDataUrl(dataUrl: string): {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
} {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('Stored image is not a data URL.');
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error('Stored image data URL is malformed.');
  }

  const header = dataUrl.slice('data:'.length, comma);
  const payload = dataUrl.slice(comma + 1);
  const parts = header.split(';').filter(Boolean);
  const mimeType = parts.find((part) => part.toLowerCase() !== 'base64') ?? '';
  const isBase64 = parts.some((part) => part.toLowerCase() === 'base64');

  if (!isBase64) {
    return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  }

  const bin = atob(decodeURIComponent(payload.replace(/\s/g, '')));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return { mimeType, bytes };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
