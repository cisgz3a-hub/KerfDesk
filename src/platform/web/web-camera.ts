// webCamera — CameraAdapter backed by getUserMedia (Chromium / Electron).
//
// navigator.mediaDevices is only present in a secure context (https or
// localhost); in an insecure context it is undefined, so isSupported() gates
// Camera Mode off entirely. The Electron renderer is Chromium and exposes the
// same API, so this one implementation serves both web and desktop.
//
// Permission contract mirrors webSerial: a user "deny" (NotAllowedError) or a
// cancelled prompt (AbortError) resolves to null; any other failure (camera in
// use, hardware error) propagates so the UI can surface it.

import type { CameraAdapter, CameraDevice, CameraStream, NetworkCamera } from '../types';

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
    return makeCameraStream(await requestStream(deviceId));
  } catch (err) {
    if (isPermissionDenied(err)) return null;
    // A stale or pre-permission-blank deviceId over-constrains getUserMedia
    // (OverconstrainedError). Fall back to the default camera before failing —
    // the first stream (before any grant) always has a blank deviceId.
    if (isOverconstrained(err) && deviceId !== undefined && deviceId !== '') {
      try {
        return makeCameraStream(await requestStream(undefined));
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
  const video: MediaTrackConstraints | boolean =
    deviceId === undefined || deviceId === '' ? true : { deviceId: { ideal: deviceId } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function isPermissionDenied(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')
  );
}

function isOverconstrained(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'OverconstrainedError';
}

function makeCameraStream(stream: MediaStream): CameraStream {
  return {
    stream,
    stop: () => {
      for (const track of stream.getTracks()) track.stop();
    },
  };
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
  discoverNetworkCamera,
};
