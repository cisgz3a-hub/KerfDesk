import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { rtspCameraUrlPolicy } from './rtsp-camera-bridge-policy.js';

export const CAMERA_BRIDGE_PORT = 51731;

export type RtspCameraBridgeHandle = {
  readonly close: () => Promise<void>;
};

export async function startLocalRtspCameraBridge(): Promise<RtspCameraBridgeHandle> {
  const server = createServer((req, res) => {
    void handleBridgeRequest(req, res).catch((err: unknown) => handleBridgeError(err, res));
  });
  await listen(server, CAMERA_BRIDGE_PORT);
  return { close: () => closeServer(server) };
}

async function handleBridgeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', `http://127.0.0.1:${CAMERA_BRIDGE_PORT}`);
  setCorsHeaders(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (requestUrl.pathname === '/health') {
    writeJson(res, { kind: 'ok', ffmpegAvailable: await hasFfmpeg() });
    return;
  }
  if (requestUrl.pathname === '/probe') {
    await handleProbe(requestUrl, res);
    return;
  }
  if (requestUrl.pathname === '/stream.mjpg') {
    await handleStream(requestUrl, res);
    return;
  }
  res.writeHead(404).end('Not Found');
}

async function handleProbe(requestUrl: URL, res: ServerResponse): Promise<void> {
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
    previewUrl: `http://127.0.0.1:${CAMERA_BRIDGE_PORT}/stream.mjpg?url=${encodeURIComponent(
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
  streamWithFfmpeg(policy.url, res);
}

function streamWithFfmpeg(url: URL, res: ServerResponse): void {
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-rtsp_transport',
    'tcp',
    '-i',
    url.toString(),
    '-an',
    '-vf',
    'fps=10',
    '-f',
    'mpjpeg',
    '-q:v',
    '5',
    'pipe:1',
  ]);
  const stderrChunks: Buffer[] = [];
  let clientClosed = false;
  let responseStarted = false;
  let settled = false;

  const startupTimer = setTimeout(() => {
    failStream(new Error('FFmpeg did not produce camera preview data.'));
  }, 10000);

  const cleanup = (): void => {
    clearTimeout(startupTimer);
  };

  const failStream = (err: Error): void => {
    if (settled) return;
    settled = true;
    cleanup();
    ffmpeg.kill('SIGTERM');
    if (clientClosed) return;
    if (responseStarted || res.headersSent) {
      res.destroy(err);
      return;
    }
    writeJson(res, { kind: 'unavailable', reason: err.message }, 502);
  };

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    appendLimitedStderrChunk(stderrChunks, chunk);
  });
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    if (settled || clientClosed) return;
    if (!responseStarted) {
      responseStarted = true;
      cleanup();
      writeMjpegResponseHeaders(res);
    }
    if (!res.write(chunk)) ffmpeg.stdout.pause();
  });
  ffmpeg.stdout.on('end', () => {
    if (!settled && responseStarted && !clientClosed) res.end();
  });
  res.on('drain', () => ffmpeg.stdout.resume());
  res.on('close', () => {
    clientClosed = true;
    settled = true;
    cleanup();
    ffmpeg.kill('SIGTERM');
  });
  ffmpeg.on('error', (err) => failStream(err));
  ffmpeg.on('exit', (code, signal) => {
    if (settled) return;
    if (code === 0 || signal === 'SIGTERM') {
      settled = true;
      cleanup();
      if (responseStarted && !clientClosed) res.end();
      return;
    }
    failStream(new Error(ffmpegFailureReason(stderrChunks, 'FFmpeg camera preview failed.')));
  });
}

function appendLimitedStderrChunk(chunks: Buffer[], chunk: Buffer): void {
  if (Buffer.concat(chunks).length < 8192) chunks.push(Buffer.from(chunk));
}

function writeMjpegResponseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
    'Cache-Control': 'no-store',
  });
}

function ffmpegFailureReason(chunks: ReadonlyArray<Buffer>, fallback: string): string {
  const stderr = Buffer.concat(chunks).toString('utf8').trim();
  return stderr.length > 0 ? `${fallback}: ${stderr}` : fallback;
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

let ffmpegAvailable: Promise<boolean> | null = null;

function hasFfmpeg(): Promise<boolean> {
  ffmpegAvailable ??= new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpeg.on('error', () => resolve(false));
    ffmpeg.on('exit', (code) => resolve(code === 0));
  });
  return ffmpegAvailable;
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
  if (origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173') return origin;
  return isTrustedHostedAppOrigin(origin) ? origin : null;
}

function isTrustedHostedAppOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'kerfdesk.com' ||
        url.hostname === 'laserforge-2fj.pages.dev' ||
        url.hostname.endsWith('.laserforge-2fj.pages.dev'))
    );
  } catch {
    return false;
  }
}

function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function handleBridgeError(err: unknown, res: ServerResponse): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const reason = err instanceof Error ? err.message : 'Camera bridge request failed.';
  writeJson(res, { kind: 'unavailable', reason }, 502);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err === undefined ? resolve() : reject(err)));
  });
}
