// @vitest-environment node
// The relay FFmpeg opens instead of the camera (ADR-692 Amendment 1), against
// a stand-in RTSP camera on 127.0.0.1 and a stand-in FFmpeg. Synthetic login
// only; nothing leaves this computer.
import { createHash } from 'node:crypto';
import { createServer, Socket, type AddressInfo, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { openRtspLoginRelay } from './rtsp-login-relay';

const USER = 'viewer';
const SECRET = 'stand-in-secret-0';
const MEDIA = Buffer.from([0x24, 0x00, 0x00, 0x04, 1, 2, 3, 4]);

type CameraMode = 'digest' | 'digest-sha256+basic' | 'basic' | 'odd-digest+basic' | 'open';
type Seen = { requestLines: string[]; authorizations: string[] };

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(() => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) server.close();
});

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function challengeFor(mode: CameraMode): string[] {
  switch (mode) {
    case 'digest':
      return ['WWW-Authenticate: Digest realm="cam", nonce="n1", qop="auth"'];
    case 'digest-sha256+basic':
      return [
        'WWW-Authenticate: Digest realm="cam", nonce="n1", algorithm=SHA-256',
        'WWW-Authenticate: Basic realm="cam"',
      ];
    case 'basic':
      return ['WWW-Authenticate: Basic realm="cam"'];
    case 'odd-digest+basic':
      return [
        'WWW-Authenticate: Digest realm="cam", nonce="n1", algorithm=SHA-512-256',
        'WWW-Authenticate: Basic realm="cam"',
      ];
    case 'open':
      return [];
  }
}

function accepted(
  mode: CameraMode,
  method: string,
  uri: string,
  auth: string | undefined,
  password: string,
): boolean {
  if (mode === 'open') return true;
  if (auth === undefined) return false;
  if (mode === 'basic')
    return auth === `Basic ${Buffer.from(`${USER}:${password}`).toString('base64')}`;
  if (mode === 'odd-digest+basic') return false;
  const field = (name: string) => new RegExp(`${name}="?([^",]*)"?`).exec(auth)?.[1] ?? '';
  if (!auth.startsWith('Digest ') || field('uri') !== uri) return false;
  const hash = mode === 'digest' ? md5 : sha256;
  const ha1 = hash(`${USER}:cam:${password}`);
  const ha2 = hash(`${method}:${uri}`);
  const expected =
    mode === 'digest'
      ? hash(`${ha1}:n1:${field('nc')}:${field('cnonce')}:auth:${ha2}`)
      : hash(`${ha1}:n1:${ha2}`);
  return field('response') === expected;
}

/** A stand-in camera that wants `mode` with `password` and serves one media frame on PLAY. */
async function camera(mode: CameraMode, password = SECRET) {
  const seen: Seen = { requestLines: [], authorizations: [] };
  const server = createServer((socket) => {
    sockets.push(socket);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      for (let end = buffer.indexOf('\r\n\r\n'); end >= 0; end = buffer.indexOf('\r\n\r\n')) {
        const head = buffer.slice(0, end);
        buffer = buffer.slice(end + 4);
        const [line = '', ...headers] = head.split('\r\n');
        const [method = '', uri = ''] = line.split(' ');
        const header = (name: string) =>
          headers
            .find((h) => h.toLowerCase().startsWith(`${name}:`))
            ?.slice(name.length + 1)
            .trim();
        const auth = header('authorization');
        seen.requestLines.push(line);
        if (auth !== undefined) seen.authorizations.push(auth);
        const cseq = header('cseq') ?? '0';
        if (!accepted(mode, method, uri, auth, password)) {
          socket.write(
            ['RTSP/1.0 401 Unauthorized', `CSeq: ${cseq}`, ...challengeFor(mode), '', ''].join(
              '\r\n',
            ),
          );
          continue;
        }
        const body =
          method === 'DESCRIBE' ? 'v=0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n' : '';
        socket.write(
          `RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
        );
        if (method === 'PLAY') socket.write(MEDIA);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, seen };
}

/** A stand-in FFmpeg: OPTIONS, DESCRIBE, SETUP and PLAY on one connection. */
async function ffmpeg(relayUrl: string) {
  const relay = new URL(relayUrl);
  const socket = new Socket();
  sockets.push(socket);
  await new Promise<void>((resolve) => socket.connect(Number(relay.port), relay.hostname, resolve));
  let received = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    received = Buffer.concat([received, chunk]);
  });
  const steps = [
    ['OPTIONS', relayUrl],
    ['DESCRIBE', relayUrl],
    ['SETUP', `${relayUrl}/trackID=1`],
    ['PLAY', relayUrl],
  ] as const;
  const replies: string[] = [];
  for (const [index, [method, uri]] of steps.entries()) {
    const cseq = 10 + index;
    socket.write(`${method} ${uri} RTSP/1.0\r\nCSeq: ${cseq}\r\nUser-Agent: Lavf\r\n\r\n`);
    const reply = await waitFor(() => {
      const text = received.toString('latin1');
      const match = new RegExp(`RTSP/1\\.0 (\\d{3})[^\\r]*\\r\\nCSeq: ${cseq}\\r\\n`).exec(text);
      return match?.[1];
    });
    replies.push(reply ?? 'none');
    if (reply !== '200') break;
  }
  return { replies, received: () => received, socket };
}

async function waitFor<T>(read: () => T | undefined, ms = 2000): Promise<T | undefined> {
  const until = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== undefined || Date.now() > until) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const cameraAddress = (port: number, password = SECRET) =>
  new URL(`rtsp://${USER}:${password}@127.0.0.1:${port}/stream1?channel=1`);

describe('the RTSP login relay (ADR-692 Amendment 1)', () => {
  it('gives FFmpeg a loopback address that holds nothing of the camera', async () => {
    const cam = await camera('open');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    expect(relay.url).toMatch(/^rtsp:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
    expect(relay.url).not.toContain(SECRET);
    expect(relay.url).not.toContain(USER);
    expect(relay.url).not.toContain(String(cam.port));
    relay.close();
  });

  it('logs in with Digest on the camera’s challenge and passes the stream through', async () => {
    const cam = await camera('digest');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    const client = await ffmpeg(relay.url);
    expect(client.replies).toEqual(['200', '200', '200', '200']);
    await waitFor(() => (client.received().includes(MEDIA) ? true : undefined));
    expect(client.received().includes(MEDIA)).toBe(true);
    const base = `rtsp://127.0.0.1:${cam.port}/stream1?channel=1`;
    expect(cam.seen.requestLines).toContain(`DESCRIBE ${base} RTSP/1.0`);
    expect(cam.seen.requestLines).toContain(`SETUP ${base}/trackID=1 RTSP/1.0`);
    for (const line of cam.seen.requestLines) expect(line).not.toContain(SECRET);
    expect(cam.seen.authorizations.length).toBeGreaterThan(0);
    for (const auth of cam.seen.authorizations) expect(auth.startsWith('Digest ')).toBe(true);
    expect(relay.loginProblem()).toBeNull();
    relay.close();
  });

  it('answers a stronger Digest rather than Basic when the camera offers both', async () => {
    const cam = await camera('digest-sha256+basic');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    const client = await ffmpeg(relay.url);
    expect(client.replies).toEqual(['200', '200', '200', '200']);
    for (const auth of cam.seen.authorizations) expect(auth).toMatch(/^Digest .*algorithm=SHA-256/);
    relay.close();
  });

  it('sends Basic only to a camera that offers nothing else', async () => {
    const cam = await camera('basic');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    expect((await ffmpeg(relay.url)).replies).toEqual(['200', '200', '200', '200']);
    expect(cam.seen.authorizations.every((auth) => auth.startsWith('Basic '))).toBe(true);
    relay.close();
  });

  it('never falls back to Basic when the camera offers a Digest it cannot compute', async () => {
    const cam = await camera('odd-digest+basic');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    expect((await ffmpeg(relay.url)).replies).toEqual(['401']);
    expect(cam.seen.authorizations).toEqual([]);
    expect(relay.loginProblem()).toBe('unsupported');
    relay.close();
  });

  it('stops at a refused login and says so, without retrying it over and over', async () => {
    const cam = await camera('digest', 'the-right-one');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    expect((await ffmpeg(relay.url)).replies).toEqual(['401']);
    expect(cam.seen.authorizations).toHaveLength(1);
    expect(relay.loginProblem()).toBe('refused');
    relay.close();
  });

  it('takes one connection only, and refuses a request naming another loopback address', async () => {
    const cam = await camera('open');
    const relay = await openRtspLoginRelay(cameraAddress(cam.port));
    const first = await ffmpeg(relay.url);
    const port = Number(new URL(relay.url).port);
    const second = new Socket();
    sockets.push(second);
    const refused = await new Promise<boolean>((resolve) => {
      second.once('error', () => resolve(true));
      second.once('connect', () => resolve(false));
      second.connect(port, '127.0.0.1');
    });
    expect(refused).toBe(true);
    const closed = new Promise<void>((resolve) => first.socket.once('close', () => resolve()));
    first.socket.write(`DESCRIBE rtsp://127.0.0.1:${port}/other RTSP/1.0\r\nCSeq: 99\r\n\r\n`);
    await closed;
    relay.close();
  });
});
