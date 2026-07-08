// @vitest-environment node
// The bridge is Node code; jsdom's patched AbortSignal is a different realm
// than undici fetch's, which rejects AbortSignal.timeout() under jsdom.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fetchFrameBytes,
  fetchFrameBytesQueued,
  handleDiscoverRequest,
} from './camera-frame-proxy';
import { startLocalRtspCameraBridge, type RtspCameraBridgeHandle } from './rtsp-camera-bridge';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const TRUSTED_ORIGIN = 'http://localhost:5173';

function listenEphemeral(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

describe('camera frame proxy over the real bridge server', () => {
  let upstream: Server;
  let upstreamPort = 0;
  let upstreamHits = 0;
  let bridge: RtspCameraBridgeHandle;

  beforeAll(async () => {
    upstream = createServer((req, res) => {
      upstreamHits += 1;
      if (req.url === '/frame') {
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(JPEG_BYTES);
        return;
      }
      if (req.url === '/untyped-frame') {
        // Some embedded cameras omit Content-Type; the JPEG magic must carry.
        res.writeHead(200);
        res.end(JPEG_BYTES);
        return;
      }
      if (req.url === '/error') {
        res.writeHead(500).end('boom');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>not a camera</html>');
    });
    upstreamPort = await listenEphemeral(upstream);
    bridge = await startLocalRtspCameraBridge(0);
  });

  afterAll(async () => {
    await bridge.close();
    await closeServer(upstream);
  });

  const bridgeUrl = (path: string): string => `http://127.0.0.1:${bridge.port}${path}`;
  const frameProxyUrl = (upstreamPath: string): string =>
    bridgeUrl(
      `/frame.jpg?url=${encodeURIComponent(`http://127.0.0.1:${upstreamPort}${upstreamPath}`)}`,
    );

  it('proxies a machine-camera JPEG with CORS for a trusted app origin', async () => {
    const response = await fetch(frameProxyUrl('/frame'), {
      headers: { Origin: TRUSTED_ORIGIN },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('access-control-allow-origin')).toBe(TRUSTED_ORIGIN);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(JPEG_BYTES);
  });

  it('defaults the content type from JPEG magic when the camera omits it', async () => {
    const response = await fetch(frameProxyUrl('/untyped-frame'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  it('refuses an untrusted Origin before contacting the camera (S03-001)', async () => {
    const hitsBefore = upstreamHits;
    const response = await fetch(frameProxyUrl('/frame'), {
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.status).toBe(403);
    expect(upstreamHits).toBe(hitsBefore);
  });

  it('rejects policy-invalid frame URLs without fetching', async () => {
    const hitsBefore = upstreamHits;
    const response = await fetch(
      bridgeUrl(`/frame.jpg?url=${encodeURIComponent('http://example.com/frame.jpg')}`),
    );
    const body: unknown = await response.json();
    expect(body).toMatchObject({ kind: 'invalid' });
    expect(upstreamHits).toBe(hitsBefore);
  });

  it('maps camera HTTP errors and non-image bodies to unavailable', async () => {
    const errorResponse = await fetch(frameProxyUrl('/error'));
    expect(errorResponse.status).toBe(502);
    expect(await errorResponse.json()).toMatchObject({ kind: 'unavailable' });

    const htmlResponse = await fetch(frameProxyUrl('/not-a-camera'));
    expect(htmlResponse.status).toBe(502);
    expect(await htmlResponse.json()).toMatchObject({
      kind: 'unavailable',
      reason: 'Camera did not return an image.',
    });
  });

  it('reports the frame proxy in /health', async () => {
    const response = await fetch(bridgeUrl('/health'));
    expect(await response.json()).toMatchObject({ kind: 'ok', frameProxy: true });
  });

  it('acknowledges Private Network Access preflights', async () => {
    const withPna = await fetch(bridgeUrl('/health'), {
      method: 'OPTIONS',
      headers: {
        Origin: TRUSTED_ORIGIN,
        'Access-Control-Request-Private-Network': 'true',
      },
    });
    expect(withPna.status).toBe(204);
    expect(withPna.headers.get('access-control-allow-private-network')).toBe('true');

    const withoutPna = await fetch(bridgeUrl('/health'), {
      method: 'OPTIONS',
      headers: { Origin: TRUSTED_ORIGIN },
    });
    expect(withoutPna.headers.get('access-control-allow-private-network')).toBeNull();
  });
});

describe('machine camera discovery', () => {
  it('reports the first responding candidate with its proxied frame URL', async () => {
    const upstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(JPEG_BYTES);
    });
    const upstreamPort = await listenEphemeral(upstream);
    // A dead candidate first: an ephemeral port that was bound then released.
    const dead = createServer(() => undefined);
    const deadPort = await listenEphemeral(dead);
    await closeServer(dead);

    const cameraUrl = `http://127.0.0.1:${upstreamPort}/frame`;
    const body = await runDiscover({
      bridgePort: 51731,
      candidates: [`http://127.0.0.1:${deadPort}/frame`, cameraUrl],
      probeTimeoutMs: 500,
    });
    expect(body).toEqual({
      kind: 'ok',
      found: {
        cameraUrl,
        proxyFrameUrl: `http://127.0.0.1:51731/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
      },
    });
    await closeServer(upstream);
  });

  it('reports null when no candidate responds', async () => {
    const dead = createServer(() => undefined);
    const deadPort = await listenEphemeral(dead);
    await closeServer(dead);
    const body = await runDiscover({
      bridgePort: 51731,
      candidates: [`http://127.0.0.1:${deadPort}/frame`],
      probeTimeoutMs: 500,
    });
    expect(body).toEqual({ kind: 'ok', found: null });
  });
});

describe('upstream serialization (single-threaded embedded cameras)', () => {
  it('never lets two requests hit the same host concurrently, but shares identical URLs', async () => {
    let active = 0;
    let maxActive = 0;
    let hits = 0;
    const upstream = createServer((req, res) => {
      hits += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
        res.end(JPEG_BYTES);
      }, 40);
    });
    const port = await listenEphemeral(upstream);
    const urlA = `http://127.0.0.1:${port}/a`;
    const urlB = `http://127.0.0.1:${port}/b`;

    // Two identical URLs (shared in-flight) + one different URL (queued).
    const [a1, a2, b] = await Promise.all([
      fetchFrameBytesQueued(urlA, 2000),
      fetchFrameBytesQueued(urlA, 2000),
      fetchFrameBytesQueued(urlB, 2000),
    ]);
    expect(a1.kind).toBe('ok');
    expect(a2.kind).toBe('ok');
    expect(b.kind).toBe('ok');
    expect(maxActive).toBe(1); // serialized per host
    expect(hits).toBe(2); // the identical pair shared one upstream fetch
    await closeServer(upstream);
  });
});

describe('fetchFrameBytes timeout', () => {
  it('fails instead of hanging when the camera stalls', async () => {
    const stalling = createServer(() => {
      // Never respond; the request must be cut off by the timeout signal.
    });
    const port = await listenEphemeral(stalling);
    const result = await fetchFrameBytes(`http://127.0.0.1:${port}/frame`, 100);
    expect(result.kind).toBe('failed');
    await closeServer(stalling);
  });
});

/** Run handleDiscoverRequest through a throwaway HTTP server and parse the JSON. */
async function runDiscover(options: {
  bridgePort: number;
  candidates: ReadonlyArray<string>;
  probeTimeoutMs: number;
}): Promise<unknown> {
  const server = createServer((_req, res) => {
    void handleDiscoverRequest(res, options);
  });
  const port = await listenEphemeral(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/discover`);
    return (await response.json()) as unknown;
  } finally {
    await closeServer(server);
  }
}
