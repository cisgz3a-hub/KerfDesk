// Frame capture for Camera Mode (ADR-108 wizard): copy the current <video>
// frame into an RgbaImage buffer, optionally downscaled. UI-layer because it
// needs a DOM canvas; the pixels then flow into the pure detector/rectifier.

import type { RgbaImage } from '../../core/camera';

// Live detection runs on a reduced frame: the X-corner response is O(pixels)
// and a ~480px-wide frame detects reliably while staying well under a
// preview-rate budget. Full-resolution capture is used for the solve itself.
export const LIVE_DETECT_TARGET_WIDTH_PX = 480;

// A live surface the detection loop can grab frames from: the wizard's
// <video> (USB) or the machine camera's <img> (bridge-proxied, so drawing it
// to a canvas does not taint — the bridge sends CORS for this origin).
export type LiveCaptureElement = HTMLVideoElement | HTMLImageElement;

/** The element's intrinsic frame size (0×0 while nothing has loaded yet). */
export function elementFrameSize(element: LiveCaptureElement): {
  readonly width: number;
  readonly height: number;
} {
  if (element instanceof HTMLVideoElement) {
    return { width: element.videoWidth, height: element.videoHeight };
  }
  return { width: element.naturalWidth, height: element.naturalHeight };
}

/**
 * Copy the element's current frame into an RGBA buffer at `scale` (1 =
 * native). Returns null while the element has no dimensions yet or when the
 * 2D context is unavailable (canvas is device-memory backed and can fail).
 */
export function captureElementFrame(
  element: LiveCaptureElement,
  scale = 1,
): RgbaImage | null {
  const intrinsic = elementFrameSize(element);
  const width = Math.round(intrinsic.width * scale);
  const height = Math.round(intrinsic.height * scale);
  if (width <= 0 || height <= 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(element, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  return { data: image.data, width: image.width, height: image.height };
}

/** Copy the video's current frame into an RGBA buffer at `scale` (1 = native). */
export function captureVideoFrame(video: HTMLVideoElement, scale = 1): RgbaImage | null {
  return captureElementFrame(video, scale);
}

/** The downscale factor that brings `videoWidth` to the live-detect budget. */
export function liveDetectScale(videoWidth: number): number {
  if (videoWidth <= LIVE_DETECT_TARGET_WIDTH_PX) return 1;
  return LIVE_DETECT_TARGET_WIDTH_PX / videoWidth;
}

/**
 * Grab one full-resolution frame from a MediaStream without needing a mounted
 * <video> (the Update Overlay path). Resolves null when no frame arrives —
 * e.g. the stream ended — rather than hanging.
 */
export function captureStreamFrame(stream: MediaStream): Promise<RgbaImage | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const done = (frame: RgbaImage | null): void => {
      video.srcObject = null;
      resolve(frame);
    };
    video.onloadeddata = () => done(captureVideoFrame(video, 1));
    video.onerror = () => done(null);
    void video.play().catch(() => done(null));
  });
}
