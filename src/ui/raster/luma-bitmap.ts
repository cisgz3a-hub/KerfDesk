// ADR-029 §4 Convert to Bitmap — the UI half of the division of labour.
//
// Pure-core (rasterizeVectorToLuma) stops at a grayscale luma grid; this
// module encodes that grid into the two bitmap fields a RasterImage carries:
//   - `dataUrl`    — a PNG the canvas renderer draws (draw-raster.ts).
//   - `lumaBase64` — the same pixels base64'd so compile-job can dither
//                    pure-core without touching the DOM.
// Both are encodings of one luma buffer, so they're produced together — the
// same pairing the Toolbar's image-import handler builds inline.
//
// Testability split (jsdom has no real canvas: getContext('2d') is null):
//   - lumaToRgba / lumaToBase64 are pure and unit-tested here.
//   - lumaToBitmap wraps them with the browser-only PNG encode,
//     which throws in jsdom — its PNG output is verified in-browser (A2-v),
//     not in the suite.
//
// NOTE: lumaToBase64 duplicates the btoa-the-luma-buffer tail of
// image-loader's extractLumaBase64 (which additionally does RGBA→luma).
// Extracting a shared `lumaBufferToBase64` is a candidate de-dup, deferred
// rather than refactoring image-loader inside this feature diff.

import type { VectorRaster } from '../../core/raster';

const RGBA_CHANNELS = 4;
const OPAQUE_ALPHA = 255;
// White (unburned) — the luma background, also the defensive default for an
// out-of-range index so a malformed buffer reads as paper, never black ink.
const FALLBACK_LUMA = 255;
const PNG_MIME = 'image/png';
// Bytes handed to one String.fromCharCode call in lumaToBase64. Any bound
// comfortably under V8's argument-count limit works; 32 KiB is the usual one.
export const LUMA_BINARY_CHUNK_BYTES = 32768;

export type BitmapFields = {
  readonly dataUrl: string;
  readonly lumaBase64: string;
};

// Encode a luma grid into a RasterImage's PNG data URL + base64 luma.
// Browser-only (the async toBlob step); throws if no 2D canvas context.
export async function lumaToBitmap(raster: VectorRaster): Promise<BitmapFields> {
  const rgba = lumaToRgba(raster);
  const dataUrl = await rgbaToPngDataUrl(rgba, raster.width, raster.height);
  return { dataUrl, lumaBase64: lumaToBase64(raster.luma) };
}

// Expand one-byte-per-pixel luma into opaque RGBA (grey = R=G=B=luma).
export function lumaToRgba(raster: VectorRaster): Uint8ClampedArray {
  const { luma, width, height } = raster;
  const rgba = new Uint8ClampedArray(width * height * RGBA_CHANNELS);
  for (let i = 0; i < width * height; i += 1) {
    const grey = luma[i] ?? FALLBACK_LUMA;
    const base = i * RGBA_CHANNELS;
    rgba[base] = grey;
    rgba[base + 1] = grey;
    rgba[base + 2] = grey;
    rgba[base + 3] = OPAQUE_ALPHA;
  }
  return rgba;
}

// Base64-encode the raw luma buffer for JSON transit (compile-job decodes it).
export function lumaToBase64(luma: Uint8Array): string {
  // btoa wants a "binary string": each char's code point is one byte. Building
  // it one append per byte costs a string node per pixel — up to ~8.4M of them
  // — and this runs on the React thread whenever the convert-bitmap worker is
  // unavailable (vector-to-bitmap's inline fallback), so hand fromCharCode a
  // bounded chunk per call instead. The bound is exactly what keeps V8's
  // argument-count limit out of reach: passing a whole multi-megapixel buffer
  // would exceed it past ~64K pixels; a fixed 32 KiB chunk never can.
  // Measured over 8.4M bytes (node V8): 704ms per-char append vs 73ms chunked.
  // TextDecoder is not a shortcut here — the 'latin1' label decodes as
  // windows-1252, so bytes 0x80-0x9F would not round-trip through btoa.
  const chunks: string[] = [];
  for (let offset = 0; offset < luma.length; offset += LUMA_BINARY_CHUNK_BYTES) {
    const chunk = luma.subarray(offset, offset + LUMA_BINARY_CHUNK_BYTES);
    // apply reads its argument list array-like (length + indexed access), which
    // a Uint8Array satisfies; TypeScript's apply signature only admits number[]
    // and no narrowing expresses "array-like of number", while copying each
    // chunk into a real array just to satisfy the type would spend back the win.
    chunks.push(String.fromCharCode.apply(null, chunk as unknown as number[]));
  }
  return btoa(chunks.join(''));
}

export async function rgbaToPngBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Could not create 2D canvas context for bitmap encoding.');
  }
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return canvasToBlob(canvas);
}

async function rgbaToPngDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string> {
  const blob = await rgbaToPngBlob(rgba, width, height);
  return blobToDataUrl(blob);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('Could not encode bitmap PNG.'));
        return;
      }
      resolve(blob);
    }, PNG_MIME);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read bitmap PNG data URL.'));
    };
    reader.onerror = () => reject(new Error('Could not read bitmap PNG data URL.'));
    reader.readAsDataURL(blob);
  });
}
