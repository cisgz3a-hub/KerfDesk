import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { writeJson } from './bridge-json.js';
import { handleDiscoverRequest, handleFrameRequest } from './camera-frame-proxy.js';
import { rtspCameraUrlPolicy } from './rtsp-camera-bridge-policy.js';
import { hasFfmpeg, hasFreeFfmpegSlot, streamWithFfmpeg } from './rtsp-camera-stream.js';

export const CAMERA_BRIDGE_PORT = 51731;

export type RtspCameraBridgeHandle = {
  readonly port: number;
  readonly close: () => Promise<void>;
};

// `port` is parameterized (0 = ephemeral) so tests can run the real server
// without colliding on the well-known bridge port; production callers use the
// default.
export async function startLocalRtspCameraBridge(
  port = CAMERA_BRIDGE_PORT,
): Promise<RtspCameraBridgeHandle> {
  const server = createServer((req, res) => {
    void handleBridgeRequest(req, res, boundPort).catch((err: unknown) =>
      handleBridgeError(err, res),
    );
  });
  const boundPort = await listen(server, port);
  return { port: boundPort, close: () => closeServer(server) };
}

async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  bridgePort: number,
): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${bridgePort}`);
  setCorsHeaders(req, res);
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
  if (!isAllowedBridgeOrigin(typeof origin === 'string' ? origin : undefined)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (requestUrl.pathname === '/health') {
    writeJson(res, { kind: 'ok', ffmpegAvailable: await hasFfmpeg(), frameProxy: true });
    return;
  }
  if (requestUrl.pathname === '/probe') {
    await handleProbe(requestUrl, res, bridgePort);
    return;
  }
  if (requestUrl.pathname === '/stream.mjpg') {
    await handleStream(requestUrl, res);
    return;
  }
  if (requestUrl.pathname === '/frame.jpg') {
    await handleFrameRequest(requestUrl, res, bridgePort);
    return;
  }
  if (requestUrl.pathname === '/discover') {
    await handleDiscoverRequest(res, { bridgePort });
    return;
  }
  res.writeHead(404).end('Not Found');
}

async function handleProbe(
  requestUrl: URL,
  res: ServerResponse,
  bridgePort: number,
): Promise<void> {
  const policy = rtspCameraUrlPolicy(requestUrl.searchParams.get('url') ?? '');
  if (policy.kind !== 'ok') {
    writeJson(res, policy);
    return;
  }
  const rtsp = await probeRtsp(policy.url);
  writeJson(res, {
    kind: 'ok',
    url: policy.url.toString(),
    ...(rtsp.codec !== undefined ? { codec: rtsp.codec } : {}),
    ffmpegAvailable: await hasFfmpeg(),
    previewUrl: `http://127.0.0.1:${bridgePort}/stream.mjpg?url=${encodeURIComponent(
      policy.url.toString(),
    )}`,
  });
}

async function handleStream(requestUrl: URL, res: ServerResponse): Promise<void> {
  const policy = rtspCameraUrlPolicy(requestUrl.searchParams.get('url') ?? '');
  if (policy.kind !== 'ok') {
    writeJson(res, policy);
    return;
  }
  if (!(await hasFfmpeg())) {
    writeJson(res, { kind: 'unavailable', reason: 'FFmpeg is not available on this computer.' });
    return;
  }
  if (!hasFreeFfmpegSlot()) {
    writeJson(res, { kind: 'unavailable', reason: 'Too many concurrent camera streams.' }, 503);
    return;
  }
  streamWithFfmpeg(policy.url, res);
}

async function probeRtsp(url: URL): Promise<{ readonly codec?: string }> {
  const port = Number(url.port || '554');
  const response = await sendRtspDescribe(url.hostname, port, url.toString());
  if (!rtspProbeIsOk(response)) throw new Error('RTSP camera did not accept DESCRIBE.');
  const codec = parseCodec(response);
  return codec === undefined ? {} : { codec };
}

export function rtspProbeIsOk(response: string): boolean {
  return /^RTSP\/\d+(?:\.\d+)?\s+200\b/i.test(response);
}

function sendRtspDescribe(host: string, port: number, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (response: string): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(2500, () => fail(new Error('RTSP probe timed out.')));
    socket.on('error', fail);
    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
      const response = completeRtspDescribeResponse(Buffer.concat(chunks));
      if (response !== null) finish(response);
    });
    socket.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    socket.connect(port, host, () => {
      socket.write(
        [`DESCRIBE ${url} RTSP/1.0`, 'CSeq: 1', 'Accept: application/sdp', '', ''].join('\r\n'),
      );
    });
  });
}

export function completeRtspDescribeResponse(buffer: Buffer): string | null {
  const headerEnd = rtspHeaderEnd(buffer);
  if (headerEnd === null) return null;
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const contentLength = rtspContentLength(header);
  const responseLength = headerEnd + contentLength;
  if (buffer.length < responseLength) return null;
  return buffer.subarray(0, responseLength).toString('utf8');
}

function rtspHeaderEnd(buffer: Buffer): number | null {
  const text = buffer.toString('latin1');
  const crlfEnd = text.indexOf('\r\n\r\n');
  if (crlfEnd >= 0) return crlfEnd + 4;
  const lfEnd = text.indexOf('\n\n');
  return lfEnd >= 0 ? lfEnd + 2 : null;
}

function rtspContentLength(header: string): number {
  const match = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
  if (match?.[1] === undefined) return 0;
  const length = Number(match[1]);
  return Number.isInteger(length) && length > 0 ? length : 0;
}

function parseCodec(response: string): string | undefined {
  const match = /^a=rtpmap:\d+\s+([^/\r\n]+)/im.exec(response);
  return match?.[1]?.trim();
}

function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  const allowedOrigin = cameraBridgeCorsOrigin(typeof origin === 'string' ? origin : undefined);
  if (allowedOrigin !== null) res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export function cameraBridgeCorsOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  if (origin === 'app://app') return origin;
  // Any loopback origin, any port: Vite falls back to a random port when 5173
  // is taken (found live during the ADR-116 hardware pass). The S03-001 threat
  // model is drive-by REMOTE pages — code already running on this machine's
  // loopback can reach the cameras without the bridge's help.
  if (isLoopbackDevOrigin(origin)) return origin;
  return isTrustedHostedAppOrigin(origin) ? origin : null;
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
// still fire. A request with no Origin (same-origin app://app document, or a
// non-browser local client that already has machine access) is allowed; a
// browser Origin we do not trust is refused before any work happens.
export function isAllowedBridgeOrigin(origin: string | undefined): boolean {
  return origin === undefined || cameraBridgeCorsOrigin(origin) !== null;
}

// Only the EXACT production origins are trusted. The former
// `.laserforge-2fj.pages.dev` wildcard trusted every Cloudflare Pages preview
// (any branch/PR the operator happened to open), each of which could then drive
// the loopback bridge's discover/frame-proxy/probe endpoints (ELE-02, S03-001).
// A preview build that must reach a local bridge should gate that behind an
// explicit dev flag, not a permanent wildcard.
const TRUSTED_HOSTED_APP_HOSTNAMES: ReadonlySet<string> = new Set([
  'kerfdesk.com',
  'laserforge-2fj.pages.dev',
]);

function isTrustedHostedAppOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && TRUSTED_HOSTED_APP_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

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
