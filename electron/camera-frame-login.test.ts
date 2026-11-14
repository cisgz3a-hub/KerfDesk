// @vitest-environment node
// Snapshot cameras get a login only when they ask, in the strongest form they
// offer, and a camera that keeps failing is left alone (ADR-692 Amendment 1).
// Stand-in cameras on 127.0.0.1 only; synthetic login.
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { forgetCameraFrameLogin } from './camera-frame-login';
import { fetchFrameBytes } from './camera-frame-proxy';
import { CameraFrameSources } from './camera-frame-sources';

const USER = 'viewer';
const SECRET = 'stand-in-secret-0';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

type Mode = 'open' | 'basic' | 'digest' | 'digest+basic';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function md5(text: string): string {
  return createHash('md5').update(text).digest('hex');
}

function digestOk(auth: string, method: string, password: string): boolean {
  const field = (name: string) => new RegExp(`${name}="?([^",]*)"?`).exec(auth)?.[1] ?? '';
  const ha1 = md5(`${USER}:cam:${password}`);
  const ha2 = md5(`${method}:${field('uri')}`);
  return field('response') === md5(`${ha1}:n1:${field('nc')}:${field('cnonce')}:auth:${ha2}`);
}

async function camera(mode: Mode, password = SECRET) {
  const seen: (string | undefined)[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const auth = req.headers.authorization;
    seen.push(auth);
    const ok =
      mode === 'open' ||
      (auth?.startsWith('Basic ') === true &&
        mode === 'basic' &&
        auth === `Basic ${Buffer.from(`${USER}:${password}`).toString('base64')}`) ||
      (auth?.startsWith('Digest ') === true &&
        mode !== 'basic' &&
        digestOk(auth, req.method ?? 'GET', password));
    if (ok) {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
      return;
    }
    const challenges = {
      basic: ['Basic realm="cam"'],
      digest: ['Digest realm="cam", nonce="n1", qop="auth"'],
      'digest+basic': ['Digest realm="cam", nonce="n1", qop="auth"', 'Basic realm="cam"'],
      open: [],
    }[mode];
    res.writeHead(401, { 'WWW-Authenticate': challenges }).end('login');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return { port: (server.address() as AddressInfo).port, seen };
}

const address = (port: number, login = `${USER}:${SECRET}@`) =>
  `http://${login}127.0.0.1:${port}/shot.jpg`;

describe('a snapshot camera’s login (ADR-692 Amendment 1)', () => {
  it('is never sent to a camera that does not ask for one', async () => {
    const cam = await camera('open');
    expect((await fetchFrameBytes(address(cam.port), 2000)).kind).toBe('ok');
    expect(cam.seen).toEqual([undefined]);
  });

  it('goes only after the camera asks, and as Digest when the camera offers it', async () => {
    for (const mode of ['digest', 'digest+basic'] as const) {
      const cam = await camera(mode);
      const url = address(cam.port);
      forgetCameraFrameLogin(url);
      expect((await fetchFrameBytes(url, 2000)).kind).toBe('ok');
      expect(cam.seen[0]).toBeUndefined();
      expect(cam.seen.slice(1).every((auth) => auth?.startsWith('Digest ') === true)).toBe(true);
      // The next picture answers at once, counting its Digest use.
      expect((await fetchFrameBytes(url, 2000)).kind).toBe('ok');
      expect(cam.seen).toHaveLength(3);
      expect(cam.seen.every((auth) => auth?.startsWith('Basic ') !== true)).toBe(true);
    }
  });

  it('goes as Basic only to a camera that offers nothing else', async () => {
    const cam = await camera('basic');
    const url = address(cam.port);
    forgetCameraFrameLogin(url);
    expect((await fetchFrameBytes(url, 2000)).kind).toBe('ok');
    expect(cam.seen[0]).toBeUndefined();
    expect(cam.seen[1]?.startsWith('Basic ')).toBe(true);
  });

  it('names a refused or missing login instead of “no picture”', async () => {
    const refusing = await camera('digest', 'the-right-one');
    const refused = await fetchFrameBytes(address(refusing.port), 2000);
    expect(refused).toMatchObject({ kind: 'failed', login: 'refused' });
    expect(refusing.seen).toHaveLength(2);
    const asking = await camera('basic');
    const needed = await fetchFrameBytes(address(asking.port, ''), 2000);
    expect(needed).toMatchObject({ kind: 'failed', login: 'needed' });
    expect(JSON.stringify([refused, needed])).not.toContain(SECRET);
  });
});

describe('a camera that fails is left alone for a while', () => {
  it('waits longer after each failure and asks again after a picture', () => {
    let now = 0;
    const sources = new CameraFrameSources(
      () => 'id-1',
      () => now,
    );
    const id = sources.register('http://192.168.1.50:8080/shot.jpg');
    sources.noteFrame(id, { reason: 'timed out' });
    expect(sources.heldBack(id)).toEqual({ reason: 'timed out' });
    now = 1000;
    expect(sources.heldBack(id)).toBeNull();
    sources.noteFrame(id, { reason: 'timed out' });
    now = 2999;
    expect(sources.heldBack(id)).not.toBeNull();
    now = 3000;
    expect(sources.heldBack(id)).toBeNull();
    // Each failure after the last wait ends: the wait stops growing at 16 s.
    for (let i = 0; i < 10; i += 1) {
      now += 16_000;
      sources.noteFrame(id, { reason: 'timed out' });
    }
    now += 15_999;
    expect(sources.heldBack(id)).not.toBeNull();
    now += 1;
    expect(sources.heldBack(id)).toBeNull();
    sources.noteFrame(id, null);
    expect(sources.heldBack(id)).toBeNull();
  });

  // Camera audit v2 K4r-P3-1: requests that shared one fetch report its one failure.
  it('counts one failure once, however many requests shared it', () => {
    let now = 0;
    const sources = new CameraFrameSources(
      () => 'id-3',
      () => now,
    );
    const id = sources.register('http://192.168.1.51:8080/shot.jpg');
    sources.noteFrame(id, { reason: 'timed out' });
    sources.noteFrame(id, { reason: 'timed out' });
    now = 1000;
    expect(sources.heldBack(id)).toBeNull();
  });

  it('stops asking after a login problem until the camera is connected again', () => {
    let now = 0;
    const sources = new CameraFrameSources(
      () => 'id-2',
      () => now,
    );
    const url = 'http://192.168.1.50:8080/shot.jpg';
    const id = sources.register(url);
    sources.noteFrame(id, { reason: 'refused', login: 'refused' });
    now = 60 * 60 * 1000;
    expect(sources.heldBack(id)).toEqual({ reason: 'refused', login: 'refused' });
    expect(sources.register(url)).toBe(id);
    expect(sources.heldBack(id)).toBeNull();
  });
});
