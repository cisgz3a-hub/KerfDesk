// ActiveCameraSource — the one abstraction every camera consumer captures
// through (ADR-116). Before this, the calibration wizard, auto-align, still
// overlay, and trace were all gated on a getUserMedia MediaStream, which a
// machine (network) camera never produces — "calibration didn't even work".
// Machine sources capture by fetching the bridge's pixel-readable /frame.jpg
// proxy; USB sources keep the existing offscreen-<video> grab.

import { type RgbaImage } from '../../core/camera';
import {
  cameraSourceIdWithoutCredentials,
  type CameraCaptureBinding,
} from '../../core/camera/camera-capture-binding';
import { assertNever } from '../../core/scene';
import type { CameraStream } from '../../platform/types';
import { defaultFrameCaptureIo, type FrameCaptureIo } from './decode-jpeg';
import { captureStreamFrame } from './frame-capture';

export type ActiveCameraSource =
  // A UVC webcam via getUserMedia — continuous MediaStream.
  | { readonly kind: 'usb'; readonly stream: CameraStream }
  // A machine snapshot camera (Falcon-style) — one JPEG per GET, via the
  // bridge proxy. `cameraUrl` is the camera's own URL (persisted/diagnostics);
  // `frameUrl` is the pixel-readable bridge proxy the UI actually fetches.
  | { readonly kind: 'machine-jpeg'; readonly frameUrl: string; readonly cameraUrl: string }
  // A machine RTSP camera — `previewUrl` is the bridge's continuous MJPEG for
  // display; `frameUrl` is the bridge's ffmpeg single-frame decode for stills.
  | {
      readonly kind: 'machine-rtsp';
      readonly frameUrl: string;
      readonly previewUrl: string;
      readonly sourceId: string;
    };

export function cameraCaptureBindingForFrame(
  source: ActiveCameraSource,
  width: number,
  height: number,
): CameraCaptureBinding {
  switch (source.kind) {
    case 'usb':
      return {
        version: 1,
        sourceKind: 'usb',
        sourceId: source.stream.sourceId,
        width,
        height,
        resizeMode: source.stream.resizeMode,
      };
    case 'machine-jpeg':
      return networkCaptureBinding('machine-jpeg', source.cameraUrl, width, height);
    case 'machine-rtsp':
      return networkCaptureBinding('machine-rtsp', source.sourceId, width, height);
    default:
      return assertNever(source, 'camera source');
  }
}

export function publicCameraSourceId(raw: string): string {
  return cameraSourceIdWithoutCredentials(raw);
}

function networkCaptureBinding(
  sourceKind: 'machine-jpeg' | 'machine-rtsp',
  rawId: string,
  width: number,
  height: number,
): CameraCaptureBinding {
  return {
    version: 1,
    sourceKind,
    sourceId: publicCameraSourceId(rawId),
    width,
    height,
    resizeMode: 'unknown',
  };
}

// Detection-tick cadence per source: USB video updates continuously (the 250ms
// budget matches the detector cost); a snapshot camera only has a fresh frame
// per poll; MJPEG previews run ~10fps but detection doesn't need all of them.
const USB_DETECT_INTERVAL_MS = 250;
export const MACHINE_JPEG_POLL_INTERVAL_MS = 1500;
const MACHINE_RTSP_DETECT_INTERVAL_MS = 500;

/** How often a consumer should sample this source for a fresh frame. */
export function sourcePollIntervalMs(source: ActiveCameraSource): number {
  switch (source.kind) {
    case 'usb':
      return USB_DETECT_INTERVAL_MS;
    case 'machine-jpeg':
      return MACHINE_JPEG_POLL_INTERVAL_MS;
    case 'machine-rtsp':
      return MACHINE_RTSP_DETECT_INTERVAL_MS;
    default:
      return assertNever(source, 'camera source');
  }
}

/**
 * Grab one full-resolution frame from any camera source. Resolves null when
 * no frame can be produced (stream ended, bridge/camera unreachable, decode
 * failure) — callers surface that as a toast/diagnostic, never a throw.
 */
export function captureSourceFrame(
  source: ActiveCameraSource,
  io: FrameCaptureIo = defaultFrameCaptureIo,
): Promise<RgbaImage | null> {
  switch (source.kind) {
    case 'usb':
      return captureStreamFrame(source.stream.stream);
    case 'machine-jpeg':
      // Cache-buster: snapshot cameras serve a fresh image per GET, but
      // intermediate caches (and the browser) must not replay a stale one.
      return fetchAndDecode(withCacheBuster(source.frameUrl), io);
    case 'machine-rtsp':
      // The bridge decodes a fresh frame per request; no buster needed.
      return fetchAndDecode(source.frameUrl, io);
    default:
      return assertNever(source, 'camera source');
  }
}

async function fetchAndDecode(url: string, io: FrameCaptureIo): Promise<RgbaImage | null> {
  const blob = await io.fetchBlob(url);
  if (blob === null) return null;
  return io.decodeToRgba(blob);
}

export function withCacheBuster(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}
