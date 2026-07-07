// PNG encoding for captured camera frames — shared by trace-from-camera
// (RasterImage dataUrl) and the snapshot save (F-CAM9). UI-layer because it
// needs a DOM canvas.

import type { RgbaImage } from '../../core/camera';

/**
 * Synchronous PNG encode via a throwaway canvas; null when the 2D context or
 * PNG encoder is unavailable (device-memory backed, or jsdom) so callers
 * surface a typed failure instead of an uncaught "Not implemented" throw.
 */
export function rgbaToPngDataUrl(image: RgbaImage): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** The same encode as a Blob for file saves; null when encoding fails. */
export function pngDataUrlToBlob(dataUrl: string): Blob | null {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return null;
  try {
    const binary = atob(dataUrl.slice(prefix.length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: 'image/png' });
  } catch {
    return null;
  }
}
