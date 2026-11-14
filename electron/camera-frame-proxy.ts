// /frame.jpg and /discover handlers for the camera bridge (ADR-116).
//
// Machine cameras send no CORS headers and (on https/app origins) are blocked
// by CSP, so the browser can neither read their pixels nor even display them.
// The bridge fetches frames server-side and re-serves them from loopback with
// CORS for trusted app origins — loopback is exempt from mixed-content
// blocking, so this works identically in the desktop app, dev server, and the
// deployed site. Lens calibration, auto-align, still overlay, trace, and
// snapshot all become possible for machine cameras through this route.
// /frame.jpg names its camera by a registered source id, never by the camera
// address, which can hold a login (rolling audit v2 04-P2-1).

import type { ServerResponse } from 'node:http';
import { writeJson } from './bridge-json.js';
import { cameraFrameUrlPolicy } from './camera-frame-proxy-policy.js';
import { cancelCameraFrameBody, readCameraFrameBody } from './camera-frame-body.js';
import type { CameraFrameFailure, CameraFrameSources } from './camera-frame-sources.js';
import {
  CAMERA_LOGIN_REASONS,
  fetchWithCameraLogin,
  forgetCameraFrameLogin,
  type CameraLoginProblem,
} from './camera-frame-login.js';
import { FFMPEG_MISSING_REASON } from './ffmpeg-path.js';
import { captureRtspFrameJpeg, hasFfmpeg } from './rtsp-camera-stream.js';

// Timeouts sized to the real hardware (ADR-116 hardware pass): the Falcon's
// embedded server takes 0.8–1.4s per frame, and aborting a request
// mid-capture wedges it for several seconds — so probes must outwait a slow
// frame rather than abort into it.
const HTTP_FRAME_TIMEOUT_MS = 10000;
const DISCOVER_PROBE_TIMEOUT_MS = 5000;
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

const MISSING_SOURCE_REASON =
  'The camera bridge no longer knows this camera. Connect the camera again.';

/** Bridge frame-proxy URL for a registered frame source. */
export function proxiedFrameUrl(sourceId: string, bridgePort: number): string {
  return `http://127.0.0.1:${bridgePort}/frame.jpg?source=${encodeURIComponent(sourceId)}`;
}

// Machine snapshot cameras are single-threaded embedded servers: concurrent
// requests wedge them for seconds (measured live on the Falcon). The bridge
// is the one choke point every consumer goes through, so it can guarantee
// the camera only ever sees one connection at a time: fetches are serialized
// per host, and concurrent requests for the SAME url share one in-flight
// fetch (the panel's preview poll and a capture ask for identical URLs).
const upstreamChainByHost = new Map<string, Promise<void>>();
const inflightByUrl = new Map<string, Promise<FetchFrameResult>>();

export function fetchFrameBytesQueued(url: string, timeoutMs: number): Promise<FetchFrameResult> {
  const inflight = inflightByUrl.get(url);
  if (inflight !== undefined) return inflight;
  const host = hostOf(url);
  const previous = upstreamChainByHost.get(host) ?? Promise.resolve();
  const run = previous.then(() => fetchFrameBytes(url, timeoutMs));
  upstreamChainByHost.set(
    host,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  inflightByUrl.set(url, run);
  void run.finally(() => {
    if (inflightByUrl.get(url) === run) inflightByUrl.delete(url);
  });
  return run;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * POST /frame-source: check a camera address against the proxy policy and
 * register it, answering with the /frame.jpg URL that names it.
 */
export function handleFrameSourceRequest(
  cameraUrl: string,
  res: ServerResponse,
  bridgePort: number,
  sources: CameraFrameSources,
): void {
  const policy = cameraFrameUrlPolicy(cameraUrl, bridgePort);
  if (policy.kind !== 'ok') {
    writeJson(res, policy);
    return;
  }
  // A new Connect asks the camera afresh, login and all.
  forgetCameraFrameLogin(policy.url.toString());
  writeJson(res, {
    kind: 'ok',
    frameUrl: proxiedFrameUrl(sources.register(policy.url.toString()), bridgePort),
  });
}

export async function handleFrameRequest(
  requestUrl: URL,
  res: ServerResponse,
  bridgePort: number,
  sources: CameraFrameSources,
): Promise<void> {
  const sourceId = requestUrl.searchParams.get('source') ?? '';
  const cameraUrl = sources.cameraUrl(sourceId);
  if (cameraUrl === undefined) {
    writeJson(res, { kind: 'invalid', reason: MISSING_SOURCE_REASON }, 404);
    return;
  }
  // The registry holds only addresses the policy passed; checking again keeps
  // the policy the one gate in front of every camera fetch.
  const policy = cameraFrameUrlPolicy(cameraUrl, bridgePort);
  if (policy.kind !== 'ok') {
    writeJson(res, policy);
    return;
  }
  // A camera that just failed is not asked again yet (ADR-692 Amendment 1).
  const held = sources.heldBack(sourceId);
  if (held !== null) {
    writeJson(res, { kind: 'unavailable', ...held }, 503);
    return;
  }
  const failure =
    policy.transport === 'rtsp'
      ? await serveRtspFrame(policy.url, res)
      : await serveHttpFrame(policy.url, res);
  sources.noteFrame(sourceId, failure);
}

// Exported for direct proxy-behavior tests: this is the fetch+serve half, BELOW
// the loopback/origin policy in handleFrameRequest, so tests exercise it against
// a loopback mock camera (the full /frame.jpg path now refuses loopback, ELE-02).
export async function serveHttpFrame(
  url: URL,
  res: ServerResponse,
): Promise<CameraFrameFailure | null> {
  const frame = await fetchFrameBytesQueued(url.toString(), HTTP_FRAME_TIMEOUT_MS);
  if (frame.kind !== 'ok') {
    const failure = frameFailure(frame.reason, frame.login);
    writeJson(res, { kind: 'unavailable', ...failure }, 502);
    return failure;
  }
  // A camera that closes its connection mid-picture can send a JPEG cut
  // short with no length, or a length that matches the cut (camera audit v2
  // K4-P3-2): without its end marker it is no picture.
  if (isJpeg(frame.contentType) && !endsLikeJpeg(frame.bytes)) {
    const failure = { reason: CUT_PICTURE_REASON };
    writeJson(res, { kind: 'unavailable', ...failure }, 502);
    return failure;
  }
  res.writeHead(200, { 'Content-Type': frame.contentType, 'Cache-Control': 'no-store' });
  res.end(frame.bytes);
  return null;
}

async function serveRtspFrame(url: URL, res: ServerResponse): Promise<CameraFrameFailure | null> {
  if (!(await hasFfmpeg())) {
    writeJson(res, { kind: 'unavailable', reason: FFMPEG_MISSING_REASON });
    return null;
  }
  const result = await captureRtspFrameJpeg(url);
  if (result.kind !== 'ok') {
    const failure = frameFailure(result.reason, result.login);
    writeJson(res, { kind: 'unavailable', ...failure }, 502);
    return failure;
  }
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
  res.end(result.jpeg);
  return null;
}

const CUT_PICTURE_REASON = 'The camera sent a picture cut short.';

function isJpeg(contentType: string): boolean {
  return /^image\/(jpeg|jpg|pjpeg)\b/i.test(contentType);
}

// A whole JPEG has its end-of-image marker, FF D9, after its picture data.
// Some cameras pad the buffer or append data after it, so the marker need not
// be last (camera audit v2 K6-P3-3: 15 or more bytes after it were refused
// as a cut picture). The picture data starts at the main image's first
// start-of-scan marker, found by walking its segments, so a thumbnail's own
// end marker inside an earlier segment does not count. Inside the picture
// data an FF byte is always followed by 00 or a restart marker, so the first
// FF D9 after it is the real end.
export function endsLikeJpeg(bytes: Uint8Array): boolean {
  const scan = firstScanOffset(bytes);
  if (scan === null) return endMarkerNearEnd(bytes);
  return (
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(END_OF_IMAGE, scan) >= 0
  );
}

const END_OF_IMAGE = Buffer.from([0xff, 0xd9]);

// Where the main image's first start-of-scan segment is, or null when the
// segments cannot be walked to one.
function firstScanOffset(bytes: Uint8Array): number | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1] ?? 0;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (marker === 0xda) return i;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    i += 2 + (((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0));
  }
  return null;
}

// Without a scan to walk to, a few padding bytes after the end marker.
function endMarkerNearEnd(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 2; i >= Math.max(0, bytes.length - 16); i -= 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
  }
  return false;
}

function frameFailure(reason: string, login: CameraLoginProblem | undefined): CameraFrameFailure {
  return login === undefined ? { reason } : { reason, login };
}

export type FetchFrameResult =
  | { readonly kind: 'ok'; readonly bytes: Buffer; readonly contentType: string }
  | {
      readonly kind: 'failed';
      readonly reason: string;
      /** Set when the camera asked for a login that was missing, refused or not sendable. */
      readonly login?: CameraLoginProblem;
    };

/** Server-side GET of a camera snapshot; exported for direct timeout tests. */
export async function fetchFrameBytes(url: string, timeoutMs: number): Promise<FetchFrameResult> {
  try {
    // A login goes only to a camera that asks, in the form it asks for.
    const fetched = await fetchWithCameraLogin(url, AbortSignal.timeout(timeoutMs));
    if (fetched.kind === 'login') {
      return {
        kind: 'failed',
        reason: CAMERA_LOGIN_REASONS[fetched.problem],
        login: fetched.problem,
      };
    }
    const response = fetched.response;
    if (!response.ok) {
      await cancelCameraFrameBody(response);
      return { kind: 'failed', reason: `Camera returned HTTP ${response.status}.` };
    }
    const bytes = await readCameraFrameBody(response);
    if (bytes.length === 0) return { kind: 'failed', reason: 'Camera returned an empty frame.' };
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
    return { kind: 'failed', reason: publicFrameError(err) };
  }
}

function publicFrameError(err: unknown): string {
  // Fetch errors may echo a URL containing query credentials. Keep those
  // in the request only, never in a bridge diagnostic response.
  if (err instanceof Error && err.message === 'Camera frame is too large.') return err.message;
  if (err instanceof Error && err.name === 'TimeoutError') return 'Camera frame fetch timed out.';
  return 'Camera frame fetch failed.';
}

export type MachineCameraDiscoveryOptions = {
  readonly bridgePort: number;
  /** Where a found camera is registered, so its frame URL names it by id. */
  readonly sources: CameraFrameSources;
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
  // Candidates live on DIFFERENT hosts, so probing them concurrently is safe
  // (per-host serialization still protects the real camera) and keeps a
  // machine-off discovery at one probe timeout instead of the sum of four.
  const probes = await Promise.all(
    candidates.map(async (cameraUrl) => {
      const frame = await fetchFrameBytesQueued(cameraUrl, timeoutMs);
      return frame.kind === 'ok' ? cameraUrl : null;
    }),
  );
  const cameraUrl = probes.find((url) => url !== null) ?? null;
  writeJson(res, {
    kind: 'ok',
    found:
      cameraUrl === null
        ? null
        : {
            cameraUrl,
            proxyFrameUrl: proxiedFrameUrl(options.sources.register(cameraUrl), options.bridgePort),
          },
  });
}
