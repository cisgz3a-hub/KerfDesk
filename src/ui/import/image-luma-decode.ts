// The photo import's readback and luma step, run in the import worker
// (performance audit S3-P2-1). The UI thread decodes and draws the image with
// the loader's own canvas code and sends a snapshot of that canvas; this reads
// it back 1:1, composites over white, takes the luma and encodes it, so the
// bytes are the ones getImageData on the loader's canvas gave. DOM-free: the
// worker hands in its OffscreenCanvas context, so tests can hand in their own.

import { bytesToBase64 } from './base64-bytes';
import { lumaBytesFromRgbaOverWhite } from './rgba-luma';

export type ImageLumaRequest = { readonly bitmap: ImageBitmap };

export type ImageLumaResponse =
  | {
      readonly kind: 'ok';
      readonly width: number;
      readonly height: number;
      readonly lumaBase64: string;
    }
  | { readonly kind: 'failed'; readonly reason: string };

type ReadbackContext = {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): { readonly data: ArrayLike<number> };
};

export function lumaFromDrawnImage(
  bitmap: ImageBitmap,
  createContext: (width: number, height: number) => ReadbackContext | null,
): ImageLumaResponse {
  try {
    const { width, height } = bitmap;
    const context = createContext(width, height);
    if (context === null) return { kind: 'failed', reason: 'no 2D context' };
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const luma = lumaBytesFromRgbaOverWhite(pixels.data, width * height);
    return { kind: 'ok', width, height, lumaBase64: bytesToBase64(luma) };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    bitmap.close();
  }
}
