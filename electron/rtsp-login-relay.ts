// FFmpeg never sees a camera address (ADR-692 Amendment 1). A process's
// arguments can be read by other programs on the computer, and FFmpeg has no
// way to take an RTSP login other than in its input address. So the bridge
// starts FFmpeg on a single-use relay on 127.0.0.1 with a random path, and the
// relay talks to the camera: it rewrites the relay address in each request to
// the camera's, answers the camera's login challenge itself (Digest when the
// camera offers it, Basic only when that is all it offers), renumbers CSeq so
// a repeated request stays in order, and passes everything else through.
// FFmpeg runs with -rtsp_transport tcp, so video arrives interleaved on the
// same connection. The relay takes one connection and then stops listening.

import { randomBytes } from 'node:crypto';
import { createServer, Socket, type AddressInfo, type Server } from 'node:net';
import { loginAnswer, staleNonce, type LoginAnswer } from './camera-login-answer.js';
import type { CameraLoginProblem } from './camera-frame-login.js';
import { rtspChallenges, rtspLogin, rtspRequestUri } from './rtsp-describe-auth.js';

export type RtspLoginRelay = {
  /** The address FFmpeg opens: loopback, a random path, nothing of the camera's. */
  readonly url: string;
  /** Set when the camera asked for a login the relay could not satisfy. */
  readonly loginProblem: () => CameraLoginProblem | null;
  readonly close: () => void;
};

// FFmpeg connects at once; a relay nobody used goes away.
const CONNECT_WITHIN_MS = 15_000;
const MAX_HEAD_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 1024 * 1024;
// A login answer is repeated once, and once more for a nonce gone stale.
const MAX_LOGIN_REPEATS = 2;

type Pending = {
  readonly clientCseq: string;
  readonly method: string;
  readonly uri: string;
  readonly headers: ReadonlyArray<string>;
  readonly body: Buffer;
  readonly repeats: number;
};

type Message = { readonly head: string; readonly body: Buffer; readonly raw: Buffer };

export async function openRtspLoginRelay(
  camera: URL,
  connectCamera: (port: number, host: string) => Socket = defaultConnect,
): Promise<RtspLoginRelay> {
  const token = randomBytes(16).toString('hex');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const relayBase = `rtsp://127.0.0.1:${port}/${token}`;
  let problem: CameraLoginProblem | null = null;
  const sockets: Socket[] = [];
  const close = (): void => {
    clearTimeout(unused);
    stopListening(server);
    for (const socket of sockets) socket.destroy();
  };
  const unused = setTimeout(close, CONNECT_WITHIN_MS);
  server.on('connection', (client) => {
    clearTimeout(unused);
    stopListening(server);
    const upstream = connectCamera(Number(camera.port || '554'), bareHost(camera.hostname));
    sockets.push(client, upstream);
    relayConnection(client, upstream, {
      relayBase,
      cameraBase: rtspRequestUri(camera),
      login: rtspLogin(camera),
      onProblem: (next) => {
        problem = next;
      },
    });
  });
  return { url: relayBase, loginProblem: () => problem, close };
}

function defaultConnect(port: number, host: string): Socket {
  return new Socket().connect(port, host);
}

function stopListening(server: Server): void {
  if (server.listening) server.close();
}

function bareHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

type RelayOptions = {
  readonly relayBase: string;
  readonly cameraBase: string;
  readonly login: ReturnType<typeof rtspLogin>;
  readonly onProblem: (problem: CameraLoginProblem) => void;
};

/** Relay one FFmpeg connection to the camera; exported for the relay's own tests. */
export function relayConnection(client: Socket, upstream: Socket, options: RelayOptions): void {
  const pending = new Map<string, Pending>();
  let cseq = 0;
  let answer: LoginAnswer | null = null;
  const end = (): void => {
    client.destroy();
    upstream.destroy();
  };
  const send = (request: Pending): void => {
    cseq += 1;
    pending.set(String(cseq), request);
    const lines = [
      `${request.method} ${request.uri} RTSP/1.0`,
      `CSeq: ${cseq}`,
      ...request.headers,
    ];
    if (answer !== null) lines.push(`Authorization: ${answer.header(request.method, request.uri)}`);
    upstream.write(Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), request.body]));
  };
  const fromClient = messageReader(
    (message) => {
      const request = parseRequest(message, options);
      if (request === null) end();
      else send(request);
    },
    (media) => forward(upstream, client, media),
    end,
  );
  const fromCamera = messageReader(
    (message) => {
      const status = /^RTSP\/\d+(?:\.\d+)?\s+(\d{3})\b/i.exec(message.head);
      const cameraCseq = headerValue(message.head, 'cseq');
      const request = cameraCseq === undefined ? undefined : pending.get(cameraCseq);
      // A request from the camera, or a reply the relay did not ask for, goes through.
      if (status === null || request === undefined) {
        forward(client, upstream, message.raw);
        return;
      }
      pending.delete(cameraCseq ?? '');
      if (status[1] === '401') {
        const next = loginRepeat(request, message.head, options);
        if (next !== null) {
          answer = next;
          send({ ...request, repeats: request.repeats + 1 });
          return;
        }
      }
      forward(client, upstream, withCseq(message, request.clientCseq));
    },
    (media) => forward(client, upstream, media),
    end,
  );
  client.on('data', fromClient);
  upstream.on('data', fromCamera);
  for (const socket of [client, upstream]) {
    socket.on('error', end);
    socket.on('close', end);
  }
}

// The answer to repeat a request the camera refused with 401, or null to
// pass the 401 on (and say why).
function loginRepeat(request: Pending, head: string, options: RelayOptions): LoginAnswer | null {
  if (options.login === null) {
    options.onProblem('needed');
    return null;
  }
  const challenges = rtspChallenges(head);
  const fresh =
    request.repeats < MAX_LOGIN_REPEATS && (request.repeats === 0 || staleNonce(challenges));
  const next = fresh ? loginAnswer(challenges, options.login) : null;
  if (next === null) options.onProblem(request.repeats > 0 ? 'refused' : 'unsupported');
  return next;
}

// Write to one side; a side that cannot keep up pauses the other.
function forward(to: Socket, from: Socket, data: Buffer): void {
  if (to.write(data)) return;
  from.pause();
  to.once('drain', () => from.resume());
}

function parseRequest(message: Message, options: RelayOptions): Pending | null {
  const lines = message.head.split('\r\n');
  const start = /^([A-Z_]+) (\S+) (RTSP\/\d\.\d)$/.exec(lines[0] ?? '');
  if (start === null) return null;
  const uri = start[2] ?? '';
  let cameraUri = uri;
  if (uri.startsWith(options.relayBase)) {
    cameraUri = `${options.cameraBase}${uri.slice(options.relayBase.length)}`;
  } else if (/^rtsps?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?:[:/]|$)/i.test(uri)) {
    // Only the relay's own address may name the loopback side.
    return null;
  }
  const headers = lines
    .slice(1)
    .filter((line) => !/^(?:cseq|authorization)\s*:/i.test(line) && line !== '');
  return {
    clientCseq: headerValue(message.head, 'cseq') ?? '0',
    method: start[1] ?? '',
    uri: cameraUri,
    headers,
    body: message.body,
    repeats: 0,
  };
}

function withCseq(message: Message, cseq: string): Buffer {
  const head = message.head.replace(/^CSeq\s*:.*$/im, `CSeq: ${cseq}`);
  return Buffer.concat([Buffer.from(`${head}\r\n\r\n`), message.body]);
}

function headerValue(head: string, name: string): string | undefined {
  const pattern = new RegExp(`^${name}\\s*:\\s*(.*)$`, 'im');
  return pattern.exec(head)?.[1]?.trim();
}

/**
 * Splits a byte stream into RTSP messages and interleaved media frames ('$',
 * channel, 16-bit length, data). Media frames are handed on untouched.
 */
function messageReader(
  onMessage: (message: Message) => void,
  onMedia: (frame: Buffer) => void,
  onBroken: () => void,
): (chunk: Buffer) => void {
  let buffer: Buffer = Buffer.alloc(0);
  return (chunk: Buffer): void => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    for (;;) {
      const next = nextPart(buffer);
      if (next.kind === 'wait') return;
      if (next.kind === 'broken') return onBroken();
      buffer = buffer.subarray(next.size);
      if (next.kind === 'media') onMedia(next.raw);
      else onMessage(next.message);
    }
  };
}

type Part =
  | { readonly kind: 'wait' }
  | { readonly kind: 'broken' }
  | { readonly kind: 'media'; readonly size: number; readonly raw: Buffer }
  | { readonly kind: 'message'; readonly size: number; readonly message: Message };

// The whole media frame or RTSP message at the start of `buffer`, if it has arrived.
function nextPart(buffer: Buffer): Part {
  if (buffer.length === 0) return { kind: 'wait' };
  if (buffer[0] === 0x24) {
    const size = buffer.length < 4 ? Infinity : 4 + buffer.readUInt16BE(2);
    if (buffer.length < size) return { kind: 'wait' };
    return { kind: 'media', size, raw: buffer.subarray(0, size) };
  }
  const headEnd = buffer.indexOf('\r\n\r\n');
  if (headEnd < 0) return buffer.length > MAX_HEAD_BYTES ? { kind: 'broken' } : { kind: 'wait' };
  const head = buffer.subarray(0, headEnd).toString('latin1');
  const length = Number(headerValue(head, 'content-length') ?? '0');
  if (!Number.isInteger(length) || length < 0 || length > MAX_BODY_BYTES) {
    return { kind: 'broken' };
  }
  const size = headEnd + 4 + length;
  if (buffer.length < size) return { kind: 'wait' };
  const message = { head, body: buffer.subarray(headEnd + 4, size), raw: buffer.subarray(0, size) };
  return { kind: 'message', size, message };
}
