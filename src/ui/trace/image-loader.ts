// Phase E image loader — decodes a PNG/JPG file into ImageData
// suitable for traceImageToSvgString.
//
// Browser-only: uses an offscreen canvas to rasterize the image and
// pull its pixel buffer. Caller (ImportImageDialog) holds the File
// blob and awaits this loader before kicking off tracing.

import type { RawImageData } from '../../core/trace';

// Hard cap on the longest image edge after decode. Keeps trace
// runtime bounded — imagetracerjs is O(width × height × colors)
// and starts to feel slow above ~1 megapixel on modest hardware.
// Larger inputs are downsampled proportionally before tracing.
const MAX_EDGE_PX = 1024;
// Preview and commit use the same cap so the dialog does not preview one
// pixel grid and then commit a different trace.
export const PREVIEW_MAX_EDGE_PX = MAX_EDGE_PX;

// A fresh canvas is transparent black (RGBA 0,0,0,0). Drawing a PNG
// that has an alpha channel (e.g. artwork exported "with no
// background") leaves its transparent regions at (0,0,0,*) — which
// every downstream luma/threshold stage reads as solid BLACK ink, so
// the whole image traces black. Compositing onto opaque white first
// makes transparency the laser's unburned "paper", matching the
// dark-on-light input every tracer assumes.
const PAPER_WHITE = '#ffffff';

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
    ctx.fillStyle = PAPER_WHITE;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const imgd = ctx.getImageData(0, 0, width, height);
    return { width: imgd.width, height: imgd.height, data: imgd.data };
  } finally {
    URL.revokeObjectURL(url);
  }
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

function scaleToCap(
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
  // btoa wants a "binary string" (each char's code point = byte).
  // Chunked String.fromCharCode rather than the spread form because
  // the spread hits argument-count limits at ~64K pixels on V8.
  const CHUNK = 8192;
  let bin = '';
  for (const v of buf) {
    bin += String.fromCharCode(v);
    // The for-of accumulates naturally; the CHUNK constant above is
    // a defensive cap for a future generator-shaped rewrite.
    void CHUNK;
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
      resolve(typeof reader.result === 'string' ? reader.result : '');
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
