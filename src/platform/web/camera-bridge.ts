// The window's side of the loopback camera bridge (ADR-116, ADR-141). The
// bridge listens on a fixed port, and loopback ports are shared by every
// program and Windows account on the PC, so the desktop app does not take
// whatever answers there on trust (rolling audit v2 04-P2-1, ADR-141
// Amendment 2). Main hands its window this launch's keys over app://app; before
// a camera address leaves the window, /health must answer a fresh challenge
// with an HMAC only the bridge main started can make. Camera addresses, which
// can hold logins, travel in request bodies; the image URLs name cameras by
// ids the bridge handed out. Local development (`pnpm camera:bridge`, the dev
// server) has no main process to hand keys over and keeps the open bridge.

import type {
  CameraBridgeAdapter,
  CameraBridgeConnection,
  CameraBridgeFrameSource,
  CameraBridgeHealth,
  CameraBridgeProbeRequest,
  CameraBridgeProbeResult,
  CameraBridgeStreamStatus,
  MachineCameraDiscovery,
} from '../types';
import { isRecord } from '../../core/util/is-record';

const DEFAULT_BRIDGE_ORIGIN = 'http://127.0.0.1:51731';
const STREAM_STATUS_TIMEOUT_MS = 3_000;
// Mirrors electron/camera-bridge-keys.ts (electron/ and src/ cannot import
// each other); electron/cross-surface-parity.test.ts keeps them equal.
const BRIDGE_TOKEN_HEADER = 'X-KerfDesk-Camera-Bridge-Token';
const BRIDGE_PROOF_LABEL = 'kerfdesk-camera-bridge-proof/1:';

const BRIDGE_NOT_RUNNING_REASON =
  'The network-camera bridge is available only in KerfDesk Desktop or local development. For local development, run pnpm camera:bridge in a separate terminal; hosted web builds support USB cameras only.';
const BRIDGE_NOT_ANSWERING_REASON =
  "KerfDesk's network-camera bridge is not answering, so network cameras cannot connect. Restart KerfDesk; if it keeps happening, save a support report.";
const NOT_OUR_BRIDGE_REASON =
  "Another program is answering on the port KerfDesk uses for network cameras, so KerfDesk did not send it the camera's address or login. Close that program, then restart KerfDesk.";
const INVALID_RESPONSE_REASON = 'The local camera bridge returned an invalid response.';

export type CameraBridgeConnect = () => Promise<CameraBridgeConnection>;

/** A bridge client for an open bridge at `bridge`, or for the connection `bridge` gives. */
export function createHttpCameraBridge(
  bridge: string | CameraBridgeConnect = DEFAULT_BRIDGE_ORIGIN,
): CameraBridgeAdapter {
  const connect = typeof bridge === 'string' ? openBridge(bridge) : bridge;
  return {
    isSupported: () => true,
    probeRtspCamera: (req) => probeRtspCamera(connect, req),
    rtspStreamStatus: (streamSessionId) => fetchStreamStatus(connect, streamSessionId),
    discoverMachineCamera: () => discoverMachineCamera(connect),
    registerFrameSource: (cameraUrl) => registerFrameSource(connect, cameraUrl),
    health: () => fetchHealth(connect),
  };
}

function openBridge(origin: string): CameraBridgeConnect {
  const connection: CameraBridgeConnection = { kind: 'open', origin: origin.replace(/\/+$/, '') };
  return () => Promise.resolve(connection);
}

type BridgeAccess =
  | {
      readonly kind: 'ok';
      readonly origin: string;
      readonly keyed: boolean;
      /** The client token for a keyed bridge; nothing for an open one. */
      readonly headers: Readonly<Record<string, string>>;
      /** The health a keyed bridge proved itself with. */
      readonly health?: CameraBridgeHealth;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * The bridge a camera address may go to: an open development bridge, or a
 * keyed one that has just answered a fresh challenge.
 */
async function verifiedBridge(connect: CameraBridgeConnect): Promise<BridgeAccess> {
  const connection = await connect();
  if (connection.kind === 'unavailable') return connection;
  if (connection.kind === 'open') {
    return { kind: 'ok', origin: connection.origin, keyed: false, headers: {} };
  }
  const health = await provenHealth(connection);
  if (health.kind !== 'ok') return health;
  return {
    kind: 'ok',
    origin: connection.origin,
    keyed: true,
    headers: { [BRIDGE_TOKEN_HEADER]: connection.clientToken },
    health,
  };
}

async function provenHealth(
  connection: Extract<CameraBridgeConnection, { readonly kind: 'keyed' }>,
): Promise<CameraBridgeHealth> {
  const challenge = randomChallenge();
  let body: unknown;
  try {
    const response = await fetch(`${connection.origin}/health?challenge=${challenge}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    body = await response.json();
  } catch {
    return { kind: 'unavailable', reason: BRIDGE_NOT_ANSWERING_REASON };
  }
  const proof = isRecord(body) && typeof body['proof'] === 'string' ? body['proof'] : null;
  if (proof === null || !(await proofMatches(connection.proofKey, challenge, proof))) {
    return { kind: 'unavailable', reason: NOT_OUR_BRIDGE_REASON };
  }
  return normalizeHealth(body);
}

async function proofMatches(proofKey: string, challenge: string, proof: string): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) return false;
  try {
    const key = await subtle.importKey(
      'raw',
      base64UrlBytes(proofKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    return await subtle.verify(
      'HMAC',
      key,
      base64UrlBytes(proof),
      new TextEncoder().encode(`${BRIDGE_PROOF_LABEL}${challenge}`),
    );
  } catch {
    return false;
  }
}

function randomChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// Status names its preview by a random session id and holds no camera
// address, so it needs no proof first.
async function fetchStreamStatus(
  connect: CameraBridgeConnect,
  streamSessionId: string,
): Promise<CameraBridgeStreamStatus> {
  const connection = await connect();
  if (connection.kind === 'unavailable') return connection;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${connection.origin}/stream-status?session=${encodeURIComponent(streamSessionId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    return normalizeStreamStatus(await response.json());
  } catch {
    return { kind: 'unavailable', reason: notAnsweringReason(connection.kind === 'keyed') };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeRtspCamera(
  connect: CameraBridgeConnect,
  req: CameraBridgeProbeRequest,
): Promise<CameraBridgeProbeResult> {
  const bridge = await verifiedBridge(connect);
  if (bridge.kind !== 'ok') return bridge;
  try {
    return normalizeProbeResult(await postCameraUrl(bridge, '/probe', req.url));
  } catch {
    return {
      kind: 'unavailable',
      reason: `${notAnsweringReason(bridge.keyed)} Built-in RTSP cameras will not appear in the browser camera picker.`,
    };
  }
}

async function registerFrameSource(
  connect: CameraBridgeConnect,
  cameraUrl: string,
): Promise<CameraBridgeFrameSource> {
  const bridge = await verifiedBridge(connect);
  if (bridge.kind !== 'ok') return bridge;
  try {
    return normalizeFrameSource(await postCameraUrl(bridge, '/frame-source', cameraUrl));
  } catch {
    return { kind: 'unavailable', reason: notAnsweringReason(bridge.keyed) };
  }
}

// The address goes in the body: a URL's query ends up in logs and error text.
async function postCameraUrl(
  bridge: Extract<BridgeAccess, { readonly kind: 'ok' }>,
  path: string,
  cameraUrl: string,
): Promise<unknown> {
  const response = await fetch(`${bridge.origin}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...bridge.headers },
    body: JSON.stringify({ url: cameraUrl }),
    cache: 'no-store',
  });
  return response.json();
}

async function discoverMachineCamera(
  connect: CameraBridgeConnect,
): Promise<MachineCameraDiscovery> {
  const bridge = await verifiedBridge(connect);
  if (bridge.kind !== 'ok') return bridge;
  try {
    const response = await fetch(`${bridge.origin}/discover`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...bridge.headers },
    });
    return normalizeDiscovery(await response.json());
  } catch {
    return { kind: 'unavailable', reason: notAnsweringReason(bridge.keyed) };
  }
}

function normalizeDiscovery(value: unknown): MachineCameraDiscovery {
  if (!isRecord(value) || value['kind'] !== 'ok') return invalidDiscoveryResponse();
  const found = value['found'];
  if (found === null) return { kind: 'not-found' };
  if (
    isRecord(found) &&
    typeof found['cameraUrl'] === 'string' &&
    typeof found['proxyFrameUrl'] === 'string'
  ) {
    return { kind: 'found', cameraUrl: found['cameraUrl'], proxyFrameUrl: found['proxyFrameUrl'] };
  }
  return invalidDiscoveryResponse();
}

function invalidDiscoveryResponse(): MachineCameraDiscovery {
  return { kind: 'unavailable', reason: INVALID_RESPONSE_REASON };
}

function normalizeFrameSource(value: unknown): CameraBridgeFrameSource {
  if (isRecord(value) && value['kind'] === 'ok' && typeof value['frameUrl'] === 'string') {
    return { kind: 'ok', frameUrl: value['frameUrl'] };
  }
  if (
    isRecord(value) &&
    (value['kind'] === 'invalid' || value['kind'] === 'unavailable') &&
    typeof value['reason'] === 'string'
  ) {
    return { kind: value['kind'], reason: value['reason'] };
  }
  return { kind: 'unavailable', reason: INVALID_RESPONSE_REASON };
}

async function fetchHealth(connect: CameraBridgeConnect): Promise<CameraBridgeHealth> {
  const bridge = await verifiedBridge(connect);
  if (bridge.kind !== 'ok') return bridge;
  if (bridge.health !== undefined) return bridge.health;
  try {
    const response = await fetch(`${bridge.origin}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return normalizeHealth(await response.json());
  } catch {
    return { kind: 'unavailable', reason: BRIDGE_NOT_RUNNING_REASON };
  }
}

// A keyed bridge is the desktop app's own, so "needs KerfDesk Desktop" would
// be wrong there: it is simply not answering.
function notAnsweringReason(keyed: boolean): string {
  return keyed ? BRIDGE_NOT_ANSWERING_REASON : BRIDGE_NOT_RUNNING_REASON;
}

function normalizeHealth(value: unknown): CameraBridgeHealth {
  if (!isRecord(value) || value['kind'] !== 'ok' || typeof value['ffmpegAvailable'] !== 'boolean') {
    return { kind: 'unavailable', reason: INVALID_RESPONSE_REASON };
  }
  return {
    kind: 'ok',
    ffmpegAvailable: value['ffmpegAvailable'],
    // Absent on pre-ADR-116 bridges: an old desktop build without the proxy.
    frameProxy: value['frameProxy'] === true,
  };
}

function normalizeProbeResult(value: unknown): CameraBridgeProbeResult {
  if (!isRecord(value)) return invalidBridgeResponse();
  if (value['kind'] === 'ok') {
    if (!isValidProbeSuccess(value)) return invalidBridgeResponse();
    return {
      kind: 'ok',
      url: value['url'],
      ...(value['codec'] !== undefined ? { codec: value['codec'] } : {}),
      ffmpegAvailable: value['ffmpegAvailable'],
      ...(value['previewUrl'] !== undefined ? { previewUrl: value['previewUrl'] } : {}),
      ...(value['streamSessionId'] !== undefined
        ? { streamSessionId: value['streamSessionId'] }
        : {}),
    };
  }
  if (
    (value['kind'] === 'invalid' || value['kind'] === 'unavailable') &&
    typeof value['reason'] === 'string'
  ) {
    return { kind: value['kind'], reason: value['reason'] };
  }
  return invalidBridgeResponse();
}

type ValidProbeSuccess = Record<string, unknown> & {
  readonly url: string;
  readonly ffmpegAvailable: boolean;
  readonly codec?: string;
  readonly previewUrl?: string;
  readonly streamSessionId?: string;
};

function isValidProbeSuccess(value: Record<string, unknown>): value is ValidProbeSuccess {
  return (
    typeof value['url'] === 'string' &&
    typeof value['ffmpegAvailable'] === 'boolean' &&
    isOptionalString(value['codec']) &&
    isOptionalString(value['previewUrl']) &&
    isOptionalString(value['streamSessionId'])
  );
}

function normalizeStreamStatus(value: unknown): CameraBridgeStreamStatus {
  if (!isRecord(value)) return invalidStreamStatus();
  if (value['kind'] === 'starting' || value['kind'] === 'live') {
    return { kind: value['kind'] };
  }
  if (
    (value['kind'] === 'failed' || value['kind'] === 'unavailable') &&
    typeof value['reason'] === 'string'
  ) {
    return { kind: value['kind'], reason: value['reason'] };
  }
  return invalidStreamStatus();
}

function invalidStreamStatus(): CameraBridgeStreamStatus {
  return {
    kind: 'unavailable',
    reason: 'The local camera bridge returned an invalid RTSP stream status.',
  };
}

function invalidBridgeResponse(): CameraBridgeProbeResult {
  return { kind: 'unavailable', reason: INVALID_RESPONSE_REASON };
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}
