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
// Smaller cap used by the live preview path so re-tracing on every
// preset switch stays sub-200ms even on photo-class input.
export const PREVIEW_MAX_EDGE_PX = 400;

export async function loadImageAsRawData(
  file: File,
  maxEdge: number = MAX_EDGE_PX,
): Promise<RawImageData> {
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
    return { width: imgd.width, height: imgd.height, data: imgd.data };
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
