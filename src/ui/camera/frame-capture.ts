// Frame capture for Camera Mode (ADR-106 wizard): copy the current <video>
// frame into an RgbaImage buffer, optionally downscaled. UI-layer because it
// needs a DOM canvas; the pixels then flow into the pure detector/rectifier.

import type { RgbaImage } from '../../core/camera';

// Live detection runs on a reduced frame: the X-corner response is O(pixels)
// and a ~480px-wide frame detects reliably while staying well under a
// preview-rate budget. Full-resolution capture is used for the solve itself.
export const LIVE_DETECT_TARGET_WIDTH_PX = 480;

/**
 * Copy the video's current frame into an RGBA buffer at `scale` (1 = native).
 * Returns null while the stream has no dimensions yet or when the 2D context
 * is unavailable (canvas is device-memory backed and can fail).
 */
export function captureVideoFrame(video: HTMLVideoElement, scale = 1): RgbaImage | null {
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width: image.width, height: image.height };
}

/** The downscale factor that brings `videoWidth` to the live-detect budget. */
export function liveDetectScale(videoWidth: number): number {
  if (videoWidth <= LIVE_DETECT_TARGET_WIDTH_PX) return 1;
  return LIVE_DETECT_TARGET_WIDTH_PX / videoWidth;
}
