// The photo import's decode, sample and luma step, run in the import worker
// (performance audit S3-P2-1). DOM-free: the worker hands in its own
// createImageBitmap and OffscreenCanvas, so tests can too.
//
// It reproduces the UI-thread loader's grid exactly or declines. The loader
// draws either a bitmap the browser resized to the target, or the decoded image
// at its own oriented size, onto a canvas the same size; both are a 1:1 copy
// here. Anything that would need the canvas to scale or turn the image (an
// engine that returned another size, or ignored the EXIF Orientation) answers
// 'fallback' and the UI-thread loader takes the file, so no route produces
// different luma bytes from the one it replaces.

import { scaleToCap } from '../trace/trace-decode-cap';
import { bytesToBase64 } from './base64-bytes';
import { lumaBytesFromRgbaOverWhite } from './rgba-luma';

type Dimensions = { readonly width: number; readonly height: number };

export type ImageLumaRequest = {
  readonly file: Blob;
  /** Oriented grid from the header; null when the header was not parsed. */
  readonly target: Dimensions | null;
  /** The browser resizes to `target` while decoding (createImageBitmap). */
  readonly resize: boolean;
  readonly maxEdge: number;
};

export type ImageLumaResponse =
  | {
      readonly kind: 'ok';
      readonly width: number;
      readonly height: number;
      readonly lumaBase64: string;
    }
  | { readonly kind: 'fallback'; readonly reason: string };

type DrawingContext = {
  drawImage(image: ImageBitmap, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): { readonly data: ArrayLike<number> };
};

export type ImageLumaDecodeHost = {
  readonly createImageBitmap: (image: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>;
  readonly createContext: (width: number, height: number) => DrawingContext | null;
};

export async function decodeImageLuma(
  request: ImageLumaRequest,
  host: ImageLumaDecodeHost,
): Promise<ImageLumaResponse> {
  const { target } = request;
  const options: ImageBitmapOptions =
    request.resize && target !== null
      ? {
          resizeWidth: target.width,
          resizeHeight: target.height,
          resizeQuality: 'high',
          imageOrientation: 'from-image',
        }
      : { imageOrientation: 'from-image' };
  const bitmap = await host.createImageBitmap(request.file, options);
  try {
    const grid = target ?? scaleToCap(bitmap.width, bitmap.height, request.maxEdge);
    if (bitmap.width !== grid.width || bitmap.height !== grid.height) {
      return { kind: 'fallback', reason: 'decoded grid differs from the target' };
    }
    const context = host.createContext(grid.width, grid.height);
    if (context === null) return { kind: 'fallback', reason: 'no 2D context' };
    context.drawImage(bitmap, 0, 0, grid.width, grid.height);
    const pixels = context.getImageData(0, 0, grid.width, grid.height);
    const luma = lumaBytesFromRgbaOverWhite(pixels.data, grid.width * grid.height);
    return { kind: 'ok', ...grid, lumaBase64: bytesToBase64(luma) };
  } finally {
    bitmap.close();
  }
}
