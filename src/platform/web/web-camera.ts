// webCamera — CameraAdapter backed by getUserMedia (Chromium / Electron).
//
// navigator.mediaDevices is only present in a secure context (https or
// localhost); in an insecure context it is undefined, so isSupported() gates
// Camera Mode off entirely. The Electron renderer is Chromium and exposes the
// same API, so this one implementation serves both web and desktop.
//
// Permission refusal (NotAllowedError) resolves to null. Device-access
// failures such as AbortError/NotReadableError propagate so the UI can offer
// recovery without mislabeling them as permission denial.

import type { CameraAdapter, CameraDevice, CameraStream, NetworkCamera } from '../types';
import { cameraStreamFromMediaStream } from './web-camera-stream';

const NETWORK_CAMERA_PORT = 8080;
const NETWORK_CAMERA_PATH = '/media/getCapturePhoto';
// RNDIS-over-USB puts the Falcon A1 Pro on 192.168.10.x and the laser is almost
// always the gateway (.1); the rest cover non-default host octets.
const NETWORK_CAMERA_HOSTS: ReadonlyArray<string> = [
  '192.168.10.1',
  '192.168.10.254',
  '192.168.10.100',
  '192.168.10.2',
];
const PROBE_TIMEOUT_MS = 2500;

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaDevices' in navigator;
}

async function listCameras(): Promise<ReadonlyArray<CameraDevice>> {
  if (!isSupported()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    // enumerateDevices rejecting (e.g. blocked by policy) is non-fatal: report
    // no cameras rather than crash the picker.
    return [];
  }
}

async function openStream(deviceId?: string): Promise<CameraStream | null> {
  if (!isSupported()) return null;
  try {
    return cameraStreamFromMediaStream(await requestStream(deviceId), deviceId);
  } catch (err) {
    if (isPermissionDenied(err)) return null;
    // A stale or pre-permission-blank deviceId over-constrains getUserMedia
    // (OverconstrainedError). Fall back to the default camera before failing —
    // the first stream (before any grant) always has a blank deviceId.
    if (isOverconstrained(err) && deviceId !== undefined && deviceId !== '') {
      try {
        return cameraStreamFromMediaStream(await requestStream(undefined), undefined);
      } catch (retryErr) {
        if (isPermissionDenied(retryErr)) return null;
        throw retryErr;
      }
    }
    throw err;
  }
}

// A blank deviceId (devices enumerated before the first permission grant report
// an empty id) means "no specific camera" -> request the default. `ideal`, not
// `exact`, so an unavailable camera degrades to the default instead of throwing.
function requestStream(deviceId?: string): Promise<MediaStream> {
  const preferredGeometry: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 15, max: 30 },
  };
  const video: MediaTrackConstraints =
    deviceId === undefined || deviceId === ''
      ? preferredGeometry
      : { ...preferredGeometry, deviceId: { ideal: deviceId } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function isPermissionDenied(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotAllowedError';
}

function isOverconstrained(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'OverconstrainedError';
}

function onDeviceChange(handler: () => void): () => void {
  if (!isSupported()) return () => undefined;
  const listener = (): void => handler();
  navigator.mediaDevices.addEventListener('devicechange', listener);
  return () => navigator.mediaDevices.removeEventListener('devicechange', listener);
}

/** Build the Falcon JPEG frame URL for a candidate host. */
export function networkCameraFrameUrl(host: string): string {
  return `http://${host}:${NETWORK_CAMERA_PORT}${NETWORK_CAMERA_PATH}`;
}

/** Return the first candidate host whose frame URL `probe` confirms, else null. */
export async function findFirstNetworkCamera(
  hosts: ReadonlyArray<string>,
  probe: (url: string) => Promise<boolean>,
): Promise<string | null> {
  for (const host of hosts) {
    const url = networkCameraFrameUrl(host);
    if (await probe(url)) return url;
  }
  return null;
}

// Probe a URL by loading it as an <img>: works cross-origin without CORS
// (unlike fetch), so it can confirm the laser's camera from an http dev page.
// Resolves true only if a real image decodes within the timeout.
function probeImageUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
    img.onload = () => {
      clearTimeout(timer);
      finish(true);
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(false);
    };
    img.src = `${url}?probe=${Date.now()}`;
  });
}

async function discoverNetworkCamera(): Promise<NetworkCamera | null> {
  const url = await findFirstNetworkCamera(NETWORK_CAMERA_HOSTS, probeImageUrl);
  return url === null ? null : { frameUrl: url };
}

export const webCamera: CameraAdapter = {
  isSupported,
  listCameras,
  openStream,
  onDeviceChange,
  discoverNetworkCamera,
};
