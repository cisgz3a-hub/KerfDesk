// /frame.jpg and /discover handlers for the camera bridge (ADR-116).
//
// Machine cameras send no CORS headers and (on https/app origins) are blocked
// by CSP, so the browser can neither read their pixels nor even display them.
// The bridge fetches frames server-side and re-serves them from loopback with
// CORS for trusted app origins — loopback is exempt from mixed-content
// blocking, so this works identically in the desktop app, dev server, and the
// deployed site. Lens calibration, auto-align, still overlay, trace, and
// snapshot all become possible for machine cameras through this route.

import type { ServerResponse } from 'node:http';
import { writeJson } from './bridge-json.js';
import { cameraFrameUrlPolicy } from './camera-frame-proxy-policy.js';
import { captureRtspFrameJpeg, hasFfmpeg } from './rtsp-camera-stream.js';

const HTTP_FRAME_TIMEOUT_MS = 5000;
const DISCOVER_PROBE_TIMEOUT_MS = 1500;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const JPEG_MAGIC = [0xff, 0xd8] as const;

// Falcon A1 Pro candidate snapshot URLs — mirrors NETWORK_CAMERA_HOSTS in
// src/platform/web/web-camera.ts (electron code cannot import from src/, so
// the list is knowingly duplicated; update both together).
export const MACHINE_CAMERA_FRAME_URL_CANDIDATES: ReadonlyArray<string> = [
  'http://192.168.10.1:8080/media/getCapturePhoto',
  'http://192.168.10.254:8080/media/getCapturePhoto',
  'http://192.168.10.100:8080/media/getCapturePhoto',
  'http://192.168.10.2:8080/media/getCapturePhoto',
];

/** Bridge frame-proxy URL for a camera URL, as served by /discover. */
export function proxiedFrameUrl(cameraUrl: string, bridgePort: number): string {
  return `http://127.0.0.1:${bridgePort}/frame.jpg?url=${encodeURIComponent(cameraUrl)}`;
}

export async function handleFrameRequest(
  requestUrl: URL,
  res: ServerResponse,
  bridgePort: number,
): Promise<void> {
  const policy = cameraFrameUrlPolicy(requestUrl.searchParams.get('url') ?? '', bridgePort);
  if (policy.kind !== 'ok') {
    writeJson(res, policy);
    return;
  }
  if (policy.transport === 'rtsp') {
    await serveRtspFrame(policy.url, res);
    return;
  }
  await serveHttpFrame(policy.url, res);
}

async function serveHttpFrame(url: URL, res: ServerResponse): Promise<void> {
  const frame = await fetchFrameBytes(url.toString(), HTTP_FRAME_TIMEOUT_MS);
  if (frame.kind !== 'ok') {
    writeJson(res, { kind: 'unavailable', reason: frame.reason }, 502);
    return;
  }
  res.writeHead(200, { 'Content-Type': frame.contentType, 'Cache-Control': 'no-store' });
  res.end(frame.bytes);
}

async function serveRtspFrame(url: URL, res: ServerResponse): Promise<void> {
  if (!(await hasFfmpeg())) {
    writeJson(res, { kind: 'unavailable', reason: 'FFmpeg is not available on this computer.' });
    return;
  }
  const result = await captureRtspFrameJpeg(url);
  if (result.kind !== 'ok') {
    writeJson(res, { kind: 'unavailable', reason: result.reason }, 502);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  res.end(result.jpeg);
}

export type FetchFrameResult =
  | { readonly kind: 'ok'; readonly bytes: Buffer; readonly contentType: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** Server-side GET of a camera snapshot; exported for direct timeout tests. */
export async function fetchFrameBytes(url: string, timeoutMs: number): Promise<FetchFrameResult> {
  try {
    // redirect: 'error' — a compromised private device must not be able to
    // bounce the proxy to a public URL (SSRF hardening).
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) {
      return { kind: 'failed', reason: `Camera returned HTTP ${response.status}.` };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) return { kind: 'failed', reason: 'Camera returned an empty frame.' };
    if (bytes.length > MAX_FRAME_BYTES) {
      return { kind: 'failed', reason: 'Camera frame is too large.' };
    }
    const contentType = response.headers.get('content-type') ?? '';
    const isJpegMagic = bytes[0] === JPEG_MAGIC[0] && bytes[1] === JPEG_MAGIC[1];
    if (!contentType.startsWith('image/') && !isJpegMagic) {
      return { kind: 'failed', reason: 'Camera did not return an image.' };
    }
    return {
      kind: 'ok',
      bytes,
      contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Camera frame fetch failed.';
    return { kind: 'failed', reason };
  }
}

export type MachineCameraDiscoveryOptions = {
  readonly bridgePort: number;
  readonly candidates?: ReadonlyArray<string>;
  readonly probeTimeoutMs?: number;
};

/**
 * Probe the machine-camera candidate URLs server-side (browser probes are
 * CSP-blocked in the desktop app and on the deployed site) and report the
 * first responding camera together with its bridge-proxied frame URL.
 */
export async function handleDiscoverRequest(
  res: ServerResponse,
  options: MachineCameraDiscoveryOptions,
): Promise<void> {
  const candidates = options.candidates ?? MACHINE_CAMERA_FRAME_URL_CANDIDATES;
  const timeoutMs = options.probeTimeoutMs ?? DISCOVER_PROBE_TIMEOUT_MS;
  for (const cameraUrl of candidates) {
    const frame = await fetchFrameBytes(cameraUrl, timeoutMs);
    if (frame.kind === 'ok') {
      writeJson(res, {
        kind: 'ok',
        found: { cameraUrl, proxyFrameUrl: proxiedFrameUrl(cameraUrl, options.bridgePort) },
      });
      return;
    }
  }
  writeJson(res, { kind: 'ok', found: null });
}
