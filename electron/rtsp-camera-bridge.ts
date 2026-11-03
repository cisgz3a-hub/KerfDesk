import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { writeJson } from './bridge-json.js';
import {
  CAMERA_BRIDGE_TOKEN_HEADER,
  cameraBridgeProof,
  carriesClientToken,
  type CameraBridgeKeys,
} from './camera-bridge-keys.js';
import {
  handleDiscoverRequest,
  handleFrameRequest,
  handleFrameSourceRequest,
} from './camera-frame-proxy.js';
import { CameraFrameSources } from './camera-frame-sources.js';
import { FFMPEG_MISSING_REASON } from './ffmpeg-path.js';
import { rtspCameraUrlPolicy } from './rtsp-camera-bridge-policy.js';
import { RtspPreviewSessions } from './rtsp-camera-session.js';
import { hasFfmpeg, hasFreeFfmpegSlot, streamWithFfmpeg } from './rtsp-camera-stream.js';
import { probeRtsp } from './rtsp-probe.js';

export { completeRtspDescribeResponse } from './rtsp-describe-response.js';
export { RTSP_LOGIN_REFUSED_REASON, RTSP_NEEDS_LOGIN_REASON, rtspProbeIsOk } from './rtsp-probe.js';

export const CAMERA_BRIDGE_PORT = 51731;

export type RtspCameraBridgeHandle = {
  readonly port: number;
  readonly close: () => Promise<void>;
};

type BridgeContext = {
  readonly port: number;
  /** Absent for local development, where no KerfDesk main process hands keys over. */
  readonly keys: CameraBridgeKeys | undefined;
  readonly previewSessions: RtspPreviewSessions;
  readonly frameSources: CameraFrameSources;
};

// The requests that name a camera. With keys they need the client token: the
// window sends them only after the bridge proved itself on /health. The image
// routes and stream status name a camera by a random id one of these handed
// out, because an <img> cannot send a header (rolling audit v2 04-P2-1).
const CAMERA_NAMING_ROUTES: ReadonlySet<string> = new Set(['/probe', '/frame-source', '/discover']);
const POST_ROUTES: ReadonlySet<string> = new Set(['/probe', '/frame-source']);
const MAX_BODY_BYTES = 16 * 1024;
const NOT_KERFDESK_REASON = 'Only the KerfDesk window that started this camera bridge can use it.';
const INVALID_BODY_REASON = 'Camera bridge request is invalid.';

/**
 * Start the bridge on `port` (0 = ephemeral, so tests run the real server
 * without colliding on the well-known port; production callers use the
 * default). With `keys` (ADR-141 Amendment 2) it answers only app://app,
 * proves itself on /health, and takes camera requests only with the client
 * token; without them, for `pnpm camera:bridge`, it trusts loopback
 * development origins as before.
 */
export async function startLocalRtspCameraBridge(
  port = CAMERA_BRIDGE_PORT,
  keys?: CameraBridgeKeys,
): Promise<RtspCameraBridgeHandle> {
  const previewSessions = new RtspPreviewSessions();
  const frameSources = new CameraFrameSources();
  let context: BridgeContext | null = null;
  const server = createServer((req, res) => {
    if (context === null) {
      res.writeHead(503).end();
      return;
    }
    void handleBridgeRequest(req, res, context).catch((err: unknown) =>
      handleBridgeError(err, res),
    );
  });
  const boundPort = await listen(server, port);
  context = { port: boundPort, keys, previewSessions, frameSources };
  return { port: boundPort, close: () => closeServer(server) };
}

async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  context: BridgeContext,
): Promise<void> {
  // DNS rebinding: a hostile page whose own host name resolves to 127.0.0.1
  // talks to the bridge as a same-origin page. It cannot choose the Host
  // header, so only the loopback names KerfDesk uses are served (ADR-141
  // Amendment 1; Node's fix for CVE-2018-7160).
  if (!isBridgeHost(req.headers.host, context.port)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const keyed = context.keys !== undefined;
  const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${context.port}`);
  setCorsHeaders(req, res, keyed);
  if (req.method === 'OPTIONS') {
    // Chrome's Private Network Access preflight for public-https → loopback
    // requests: acknowledge it so the deployed site keeps reaching the bridge.
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.writeHead(204).end();
    return;
  }
  // S03-001: refuse an untrusted browser Origin BEFORE any side-effecting work.
  // CORS headers only gate response reads, not the request's ffmpeg/RTSP effects.
  const origin = req.headers.origin;
  if (!isAllowedBridgeOrigin(typeof origin === 'string' ? origin : undefined, !keyed)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const route = requestUrl.pathname;
  if ((req.method === 'POST') !== POST_ROUTES.has(route)) {
    res.writeHead(405).end('Method Not Allowed');
    return;
  }
  const token = req.headers[CAMERA_BRIDGE_TOKEN_HEADER.toLowerCase()];
  if (
    context.keys !== undefined &&
    CAMERA_NAMING_ROUTES.has(route) &&
    !carriesClientToken(token, context.keys.clientToken)
  ) {
    writeJson(res, { kind: 'unavailable', reason: NOT_KERFDESK_REASON }, 403);
    return;
  }
  await routeBridgeRequest(req, requestUrl, res, context);
}

async function routeBridgeRequest(
  req: IncomingMessage,
  requestUrl: URL,
  res: ServerResponse,
  context: BridgeContext,
): Promise<void> {
  const { port, previewSessions, frameSources } = context;
  switch (requestUrl.pathname) {
    case '/health':
      writeJson(res, await health(requestUrl, context));
      return;
    case '/probe': {
      const url = await readCameraUrl(req);
      if (url === null) writeJson(res, { kind: 'invalid', reason: INVALID_BODY_REASON }, 400);
      else await handleProbe(url, res, port, previewSessions);
      return;
    }
    case '/stream.mjpg':
      await handleStream(requestUrl, res, previewSessions);
      return;
    case '/stream-status':
      writeJson(res, previewSessions.status(requestUrl.searchParams.get('session') ?? ''));
      return;
    case '/frame-source': {
      const url = await readCameraUrl(req);
      if (url === null) writeJson(res, { kind: 'invalid', reason: INVALID_BODY_REASON }, 400);
      else handleFrameSourceRequest(url, res, port, frameSources);
      return;
    }
    case '/frame.jpg':
      await handleFrameRequest(requestUrl, res, port, frameSources);
      return;
    case '/discover':
      await handleDiscoverRequest(res, { bridgePort: port, sources: frameSources });
      return;
    default:
      res.writeHead(404).end('Not Found');
  }
}

// With keys, a `challenge` gets the HMAC only this bridge can make, so the
// window knows it is talking to the bridge its own main process started.
async function health(requestUrl: URL, context: BridgeContext): Promise<Record<string, unknown>> {
  const challenge = requestUrl.searchParams.get('challenge');
  const proof =
    context.keys === undefined || challenge === null
      ? null
      : cameraBridgeProof(context.keys.proofKey, challenge);
  return {
    kind: 'ok',
    ffmpegAvailable: await hasFfmpeg(),
    frameProxy: true,
    ...(proof === null ? {} : { proof }),
  };
}

// The camera address comes in a JSON body, never in the URL: a URL's query
// ends up in logs and error text, and it can hold the camera's login.
async function readCameraUrl(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += bytes.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(bytes);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const url = (value as Record<string, unknown>)['url'];
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

async function handleProbe(
  cameraUrl: string,
  res: ServerResponse,
  bridgePort: number,
  previewSessions: RtspPreviewSessions,
): Promise<void> {
  const policy = rtspCameraUrlPolicy(cameraUrl);
  if (policy.kind !== 'ok') {
    writeJson(res, policy);
    return;
  }
  const rtsp = await probeRtsp(policy.url);
  const streamSessionId = previewSessions.create(policy.url.toString());
  if (streamSessionId === null) {
    writeJson(res, { kind: 'unavailable', reason: 'Too many active RTSP preview sessions.' }, 503);
    return;
  }
  writeJson(res, {
    kind: 'ok',
    url: policy.url.toString(),
    ...(rtsp.codec !== undefined ? { codec: rtsp.codec } : {}),
    ffmpegAvailable: await hasFfmpeg(),
    previewUrl: `http://127.0.0.1:${bridgePort}/stream.mjpg?session=${encodeURIComponent(
      streamSessionId,
    )}`,
    streamSessionId,
  });
}

async function handleStream(
  requestUrl: URL,
  res: ServerResponse,
  previewSessions: RtspPreviewSessions,
): Promise<void> {
  const sessionId = requestUrl.searchParams.get('session') ?? '';
  const policy = rtspCameraUrlPolicy(previewSessions.sourceUrl(sessionId) ?? '');
  const lifecycle =
    policy.kind === 'ok' ? previewSessions.claim(sessionId, policy.url.toString()) : null;
  if (policy.kind !== 'ok' || lifecycle === null) {
    writeJson(res, { kind: 'invalid', reason: 'RTSP preview session is missing or expired.' }, 409);
    return;
  }
  if (!(await hasFfmpeg())) {
    const reason = FFMPEG_MISSING_REASON;
    lifecycle.markRejected(reason);
    writeJson(res, { kind: 'unavailable', reason });
    return;
  }
  if (!hasFreeFfmpegSlot()) {
    const reason = 'Too many concurrent camera streams.';
    lifecycle.markRejected(reason);
    writeJson(res, { kind: 'unavailable', reason }, 503);
    return;
  }
  streamWithFfmpeg(policy.url, res, {
    onLive: lifecycle.markLive,
    onFailure: lifecycle.markFailed,
    onClosed: lifecycle.markClosed,
  });
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse, keyed: boolean): void {
  const origin = req.headers.origin;
  const allowedOrigin = cameraBridgeCorsOrigin(
    typeof origin === 'string' ? origin : undefined,
    !keyed,
  );
  if (allowedOrigin !== null) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', `Content-Type, ${CAMERA_BRIDGE_TOKEN_HEADER}`);
}

/**
 * The Origin the bridge answers with CORS, or null. A keyed bridge (the
 * desktop app) answers only app://app; `devOrigins` adds the loopback
 * development pages a bridge without keys serves.
 */
export function cameraBridgeCorsOrigin(
  origin: string | undefined,
  devOrigins = true,
): string | null {
  if (origin === undefined) return null;
  if (origin === 'app://app') return origin;
  // Any loopback origin, any port: Vite falls back to a random port when 5173
  // is taken (found live during the ADR-116 hardware pass). The S03-001 threat
  // model is drive-by REMOTE pages — code already running on this machine's
  // loopback can reach the cameras without the bridge's help.
  if (devOrigins && isLoopbackDevOrigin(origin)) return origin;
  return null;
}

function isLoopbackDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

// S03-001 server-side request gate. CORS only stops a browser READING a
// cross-origin response; the request's side effects (RTSP probe / ffmpeg spawn)
// still fire, so a browser Origin we do not trust is refused before any work.
// A request with NO Origin is refused too (ADR-141 Amendment 1). KerfDesk never
// sends one: its fetch() calls are cross-origin from app://app, and its camera
// <img> elements load with crossOrigin="anonymous". A no-Origin request is a
// plain <img> on another site or a DNS-rebound same-origin page, which could
// otherwise make the bridge probe and proxy cameras on the local network.
export function isAllowedBridgeOrigin(origin: string | undefined, devOrigins = true): boolean {
  return origin !== undefined && cameraBridgeCorsOrigin(origin, devOrigins) !== null;
}

export function isBridgeHost(host: string | undefined, bridgePort: number): boolean {
  return host === `127.0.0.1:${bridgePort}` || host === `localhost:${bridgePort}`;
}

// Hosted pages are intentionally not trusted. A token readable by a hosted
// client would also be readable by same-origin XSS, so network-camera access is
// confined to the packaged app and local development (ADR-136).
function handleBridgeError(err: unknown, res: ServerResponse): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const reason = err instanceof Error ? err.message : 'Camera bridge request failed.';
  writeJson(res, { kind: 'unavailable', reason }, 502);
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err === undefined ? resolve() : reject(err)));
  });
}
