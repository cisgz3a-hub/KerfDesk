// @vitest-environment node
// Rolling audit v2 04-P2-1 (ADR-141 Amendment 2): KerfDesk's window can tell
// its own camera bridge from a program that took the port first, and no other
// program or page can name a camera to it.

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CAMERA_BRIDGE_PROOF_LABEL,
  CAMERA_BRIDGE_TOKEN_HEADER,
  cameraBridgeProof,
  carriesClientToken,
  createCameraBridgeKeys,
} from './camera-bridge-keys';
import { startLocalRtspCameraBridge, type RtspCameraBridgeHandle } from './rtsp-camera-bridge';

const APP_ORIGIN = 'app://app';
const CHALLENGE = 'Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5';

describe('camera bridge keys', () => {
  it('are fresh random 32-byte values each launch', () => {
    const first = createCameraBridgeKeys();
    const second = createCameraBridgeKeys();
    expect(Buffer.from(first.proofKey, 'base64url')).toHaveLength(32);
    expect(Buffer.from(first.clientToken, 'base64url')).toHaveLength(32);
    expect(first.proofKey).not.toBe(second.proofKey);
    expect(first.proofKey).not.toBe(first.clientToken);
  });

  it('prove a challenge with an HMAC of the labelled challenge, and refuse a malformed one', () => {
    const { proofKey } = createCameraBridgeKeys();
    expect(cameraBridgeProof(proofKey, CHALLENGE)).toBe(
      createHmac('sha256', Buffer.from(proofKey, 'base64url'))
        .update(`${CAMERA_BRIDGE_PROOF_LABEL}${CHALLENGE}`)
        .digest('base64url'),
    );
    expect(cameraBridgeProof(proofKey, 'short')).toBeNull();
    expect(cameraBridgeProof(proofKey, `${CHALLENGE}&x=1`)).toBeNull();
  });

  it('match the client token exactly', () => {
    expect(carriesClientToken('abc', 'abc')).toBe(true);
    expect(carriesClientToken('abd', 'abc')).toBe(false);
    expect(carriesClientToken('ab', 'abc')).toBe(false);
    expect(carriesClientToken(undefined, 'abc')).toBe(false);
    expect(carriesClientToken(['abc'], 'abc')).toBe(false);
  });
});

describe('a bridge started with keys', () => {
  const keys = createCameraBridgeKeys();
  let bridge: RtspCameraBridgeHandle;
  let open: RtspCameraBridgeHandle;

  beforeAll(async () => {
    bridge = await startLocalRtspCameraBridge(0, keys);
    open = await startLocalRtspCameraBridge(0);
  });

  afterAll(async () => {
    await bridge.close();
    await open.close();
  });

  const at = (handle: RtspCameraBridgeHandle, path: string): string =>
    `http://127.0.0.1:${handle.port}${path}`;
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> =>
    fetch(at(bridge, path), {
      method: 'POST',
      headers: { Origin: APP_ORIGIN, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('answers a challenge on /health with the proof only it can make', async () => {
    const response = await fetch(at(bridge, `/health?challenge=${CHALLENGE}`), {
      headers: { Origin: APP_ORIGIN },
    });
    expect(await response.json()).toMatchObject({
      kind: 'ok',
      frameProxy: true,
      proof: cameraBridgeProof(keys.proofKey, CHALLENGE),
    });
    // A bridge without keys (pnpm camera:bridge) proves nothing.
    const dev = await fetch(at(open, `/health?challenge=${CHALLENGE}`), {
      headers: { Origin: APP_ORIGIN },
    });
    expect(await dev.json()).not.toHaveProperty('proof');
  });

  it('refuses every request that names a camera without the client token', async () => {
    const cameraUrl = 'rtsp://admin:S3cret@192.168.1.10/live';
    for (const response of [
      await post('/probe', { url: cameraUrl }),
      await post('/frame-source', { url: cameraUrl }),
      await post('/probe', { url: cameraUrl }, { [CAMERA_BRIDGE_TOKEN_HEADER]: keys.proofKey }),
      await fetch(at(bridge, '/discover'), { headers: { Origin: APP_ORIGIN } }),
    ]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ kind: 'unavailable' });
    }
    const registered = await post(
      '/frame-source',
      { url: 'http://192.168.10.1:8080/media/getCapturePhoto' },
      { [CAMERA_BRIDGE_TOKEN_HEADER]: keys.clientToken },
    );
    expect(registered.status).toBe(200);
    expect(await registered.json()).toMatchObject({ kind: 'ok' });
  });

  it('answers only KerfDesk’s app origin, and lets it send the token header', async () => {
    const devPage = await fetch(at(bridge, '/health'), {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(devPage.status).toBe(403);
    const preflight = await fetch(at(bridge, '/probe'), {
      method: 'OPTIONS',
      headers: { Origin: APP_ORIGIN, 'Access-Control-Request-Method': 'POST' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).toBe(APP_ORIGIN);
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
    expect(preflight.headers.get('access-control-allow-headers')).toContain(
      CAMERA_BRIDGE_TOKEN_HEADER,
    );
    // The open development bridge still serves the dev page.
    const dev = await fetch(at(open, '/health'), { headers: { Origin: 'http://localhost:5173' } });
    expect(dev.status).toBe(200);
  });

  it('takes the RTSP address in the probe body and streams by session alone', async () => {
    const token = { [CAMERA_BRIDGE_TOKEN_HEADER]: keys.clientToken };
    // A public host is refused by policy before any RTSP is sent.
    const refused = await post('/probe', { url: 'rtsp://8.8.8.8/live' }, token);
    expect(await refused.json()).toMatchObject({ kind: 'invalid' });
    const viaQuery = await fetch(
      at(bridge, `/probe?url=${encodeURIComponent('rtsp://192.168.1.10/live')}`),
      { headers: { Origin: APP_ORIGIN, ...token } },
    );
    expect(viaQuery.status).toBe(405);
    // The old stream URL carried the address; without a session it is not served.
    const stream = await fetch(
      at(bridge, `/stream.mjpg?url=${encodeURIComponent('rtsp://192.168.1.10/live')}`),
      { headers: { Origin: APP_ORIGIN } },
    );
    expect(stream.status).toBe(409);
    expect(await stream.json()).toMatchObject({ kind: 'invalid' });
  });
});
