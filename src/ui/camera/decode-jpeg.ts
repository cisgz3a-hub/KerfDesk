// Default fetch+decode IO for machine-camera frame capture (ADR-116). The
// bridge's /frame.jpg responses carry CORS for this app origin, so the bytes
// are fetchable and the decoded canvas is untainted. Injectable because jsdom
// implements neither fetch-to-Blob against a real bridge nor
// createImageBitmap — tests substitute both.

import type { RgbaImage } from '../../core/camera';

export type FrameCaptureIo = {
  // Resolve the response body, or null on any network/HTTP failure.
  readonly fetchBlob: (url: string) => Promise<Blob | null>;
  // Decode an image blob to RGBA pixels, or null when undecodable.
  readonly decodeToRgba: (blob: Blob) => Promise<RgbaImage | null>;
};

async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

async function decodeToRgba(blob: Blob): Promise<RgbaImage | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return { data: image.data, width: image.width, height: image.height };
  } catch {
    return null;
  }
}

export const defaultFrameCaptureIo: FrameCaptureIo = { fetchBlob, decodeToRgba };
