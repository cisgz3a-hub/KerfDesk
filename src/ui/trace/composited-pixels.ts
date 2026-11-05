// The trace source's pixels composited over white, as the loader reads them
// off its canvas. DOM-free, so the trace dialog's decode can read a snapshot of
// the loader's canvas back in a worker (perf audit S5-P3-3), as the photo
// import does since S3-P2-1: the bytes are the ones getImageData on the
// loader's canvas gave, and the work leaves the UI thread.

import type { RawImageData } from '../../core/trace';
import { compositeChannel } from '../import/rgba-luma';
import { rawImageHasTransparency } from './raw-image-transparency';

export function compositeRgbOverWhitePreservingAlpha(image: RawImageData): RawImageData {
  if (image.rgbCompositedOnWhite === true) return image;
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] ?? 255;
    const opacity = alpha / 255;
    data[i] = compositeChannel(image.data[i], opacity);
    data[i + 1] = compositeChannel(image.data[i + 1], opacity);
    data[i + 2] = compositeChannel(image.data[i + 2], opacity);
    data[i + 3] = alpha;
  }
  return { width: image.width, height: image.height, data, rgbCompositedOnWhite: true };
}

export type CompositedPixelsResponse =
  | { readonly kind: 'ok'; readonly image: RawImageData; readonly hasTransparency: boolean }
  | { readonly kind: 'failed'; readonly reason: string };

type ReadbackContext = {
  drawImage(image: ImageBitmap, dx: number, dy: number): void;
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray };
};

export function compositedPixelsFromDrawnImage(
  bitmap: ImageBitmap,
  createContext: (width: number, height: number) => ReadbackContext | null,
): CompositedPixelsResponse {
  try {
    const { width, height } = bitmap;
    const context = createContext(width, height);
    if (context === null) return { kind: 'failed', reason: 'no 2D context' };
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    const image = compositeRgbOverWhitePreservingAlpha({
      width: pixels.width,
      height: pixels.height,
      data: pixels.data,
    });
    return { kind: 'ok', image, hasTransparency: rawImageHasTransparency(image) };
  } catch (error) {
    return { kind: 'failed', reason: error instanceof Error ? error.message : String(error) };
  } finally {
    bitmap.close();
  }
}
