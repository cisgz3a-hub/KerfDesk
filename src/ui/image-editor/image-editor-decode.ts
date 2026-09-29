// Decode a RasterImage's stored dataUrl into the editor's RGBA working
// document, and bake the edited document back to the RasterImage fields
// (ADR-242 Apply contract: new dataUrl + re-derived luma, dimensions
// unchanged, mm bounds untouched). Reuses the trace loader's decode path and
// luma derivation so the editor sees exactly the pixels trace/engrave see.

import type { RgbaBuffer } from '../../core/image-edit';
import type { RasterImage } from '../../core/scene';
import type { RawImageData } from '../../core/trace';
import { readRasterSourceFile } from '../import/paged-raster-source';
import {
  extractLumaBase64,
  fitDecodeToStoredGrid,
  loadImageAsRawData,
  readFileAsDataUrl,
} from '../trace/image-loader';
import type { BitmapFields } from './image-editor-types';

const EDITOR_DECODE_FILENAME = 'image-studio-source';
const MAX_BYTE = 255;

export async function decodeRasterToBuffer(image: RasterImage): Promise<RgbaBuffer> {
  // Production CSP intentionally excludes data: from connect-src. Decode the
  // embedded source directly instead of routing it through fetch(dataUrl).
  const file = await readRasterSourceFile(image, EDITOR_DECODE_FILENAME);
  // Native resolution: the stored pixel dims are already inside the import
  // caps, so the cap only prevents an unexpected upscale. The stored grid
  // also holds for a turned JPEG saved before ADR-404 honoured EXIF.
  const maxEdge = Math.max(image.pixelWidth, image.pixelHeight, 1);
  const decoded = await loadImageAsRawData(file, maxEdge);
  return straightColourForEditor(
    fitDecodeToStoredGrid(decoded, image.pixelWidth, image.pixelHeight),
  );
}

// The loader's RGB is already composited over white (the tone import burns),
// with alpha kept. The editor's Background layer is straight colour that its
// one composite path blends over white, so passing those bytes through applied
// alpha twice: black at 50% baked as luma 191 instead of 127. Undoing the white
// composite (W3C Compositing 5.1 over white: c = 255 - a(255 - s)) lets Apply
// reproduce the imported tone while tools that read alpha still see it. A fully
// transparent pixel has no colour of its own, so it becomes paper white.
function straightColourForEditor(pixels: RawImageData): RgbaBuffer {
  if (pixels.rgbCompositedOnWhite !== true) return pixels;
  const { width, height, data } = pixels;
  if (isFullyOpaque(data)) return { width, height, data };
  const straight = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? MAX_BYTE;
    straight[i] = straightChannel(data[i] ?? MAX_BYTE, alpha);
    straight[i + 1] = straightChannel(data[i + 1] ?? MAX_BYTE, alpha);
    straight[i + 2] = straightChannel(data[i + 2] ?? MAX_BYTE, alpha);
    straight[i + 3] = alpha;
  }
  return { width, height, data: straight };
}

function isFullyOpaque(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== MAX_BYTE) return false;
  }
  return true;
}

function straightChannel(composited: number, alpha: number): number {
  if (alpha === 0) return MAX_BYTE;
  const value = Math.round(MAX_BYTE - ((MAX_BYTE - composited) * MAX_BYTE) / alpha);
  return Math.min(MAX_BYTE, Math.max(0, value));
}

export async function bakeBufferToBitmapFields(doc: RgbaBuffer): Promise<BitmapFields> {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('Could not create a 2D canvas to encode the edited image.');
  // Session pixels remain editable while encoding waits. Both representations
  // must describe this same revision, using the captured dimensions and pixels.
  const pixels = new ImageData(new Uint8ClampedArray(doc.data), doc.width, doc.height);
  ctx.putImageData(pixels, 0, 0);
  const lumaBase64 = extractLumaBase64(pixels);
  const blob = await new Promise<Blob>((resolve, reject) => {
    // Async encode (never the sync toDataURL string path — RESEARCH_LOG
    // 2026-06-04 memory-pressure finding).
    canvas.toBlob((result) => {
      if (result === null) reject(new Error('PNG encode failed for the edited image.'));
      else resolve(result);
    }, 'image/png');
  });
  const dataUrl = await readFileAsDataUrl(new File([blob], 'edited.png', { type: 'image/png' }));
  return { dataUrl, lumaBase64 };
}
