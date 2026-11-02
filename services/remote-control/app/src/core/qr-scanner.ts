import decodeQr from '../../../scripts/scanner-decoder-entry.js';

const MAX_FRAME_SIDE = 960;

type NativeDetector = { detect: (source: CanvasImageSource) => Promise<{ rawValue?: unknown }[]> };
type NativeDetectorClass = {
  new (options: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
};
export type QrReader = (video: HTMLVideoElement) => Promise<string | null>;

/** Frames stay on this phone. The platform reader is tried first, but some phones expose one that
 *  never finds anything, so the local decoder also reads every other frame it misses. */
export async function createQrReader(): Promise<QrReader> {
  let native = await nativeDetector();
  let misses = 0;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) return null;
    if (native !== null) {
      try {
        const value = (await native.detect(video)).find(
          (item) => typeof item.rawValue === 'string',
        )?.rawValue;
        if (typeof value === 'string') return value;
        if (++misses % 2 !== 0) return null;
      } catch {
        native = null;
      }
    }
    if (context === null) return null;
    // The centre square holds the on-screen guide; reading it unscaled keeps small codes legible.
    const side = Math.min(video.videoWidth, video.videoHeight);
    const size = Math.min(side, MAX_FRAME_SIDE);
    canvas.width = canvas.height = size;
    context.drawImage(
      video,
      (video.videoWidth - side) / 2,
      (video.videoHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const pixels = context.getImageData(0, 0, size, size);
    return decodeQr(pixels.data, size, size)?.data ?? null;
  };
}

async function nativeDetector(): Promise<NativeDetector | null> {
  const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
  if (typeof Detector !== 'function') return null;
  try {
    if (
      typeof Detector.getSupportedFormats === 'function' &&
      !(await Detector.getSupportedFormats()).includes('qr_code')
    )
      return null;
    return new Detector({ formats: ['qr_code'] });
  } catch {
    return null;
  }
}

/** A rear camera at a resolution that keeps a dense code on a PC screen readable from a distance. */
export function requestCamera(): Promise<MediaStream> {
  if (typeof navigator.mediaDevices?.getUserMedia !== 'function')
    return Promise.reject(new Error('camera_unavailable'));
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  });
}

export function stopCamera(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access is blocked. Allow the camera for this page in your browser settings, or enter the code instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found. Enter the code instead.';
  if (name === 'NotReadableError')
    return 'The camera is in use by another app. Close it and try again, or enter the code instead.';
  return 'The camera isn’t available. Enter the code instead.';
}
