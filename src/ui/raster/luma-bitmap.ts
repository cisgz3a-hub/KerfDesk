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
  // btoa wants a "binary string": each char's code point is one byte.
  // String.fromCharCode in a loop (not the spread form, which hits V8's
  // argument-count limit past ~64K pixels).
  let bin = '';
  for (const v of luma) {
    bin += String.fromCharCode(v);
  }
  return btoa(bin);
}

async function rgbaToPngDataUrl(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string> {
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
  const blob = await canvasToBlob(canvas);
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
