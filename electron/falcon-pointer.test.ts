// @vitest-environment node
// The bridge is Node code; jsdom's AbortSignal is a different realm than
// undici fetch's, which rejects AbortSignal.timeout() under jsdom.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  falconPointerBody,
  falconPointerHostIssue,
  FALCON_POINTER_PATH,
  switchFalconPointer,
} from './falcon-pointer';
import { startLocalRtspCameraBridge, type RtspCameraBridgeHandle } from './rtsp-camera-bridge';

const TRUSTED_ORIGIN = 'http://localhost:5173';

type Received = {
  readonly method?: string;
  readonly url?: string;
  readonly type?: string;
  readonly body: string;
};

describe('Falcon pointer request (ADR-635)', () => {
  let falcon: Server;
  let falconPort = 0;
  let status = 200;
  let silent = false;
  const received: Received[] = [];
  let bridge: RtspCameraBridgeHandle;

  beforeAll(async () => {
    falcon = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push({
          method: req.method,
          url: req.url,
          type: req.headers['content-type'],
          body,
        });
        if (silent) return;
        res.writeHead(status, { 'Content-Type': 'application/json' }).end('{"code":0}');
      });
    });
    falconPort = await new Promise((resolve) =>
      falcon.listen(0, '127.0.0.1', () => resolve((falcon.address() as AddressInfo).port)),
    );
    bridge = await startLocalRtspCameraBridge(0);
  });

  afterAll(async () => {
    await bridge.close();
    await new Promise<void>((resolve) => {
      falcon.closeAllConnections();
      falcon.close(() => resolve());
    });
  });

  it('sends exactly the JSON body Creality’s software sends to assist light 0', () => {
    expect(falconPointerBody(true)).toBe('{"switch":1}');
    expect(falconPointerBody(false)).toBe('{"switch":0}');
    expect(FALCON_POINTER_PATH).toBe('/device/assistLight');
  });

  it('accepts only a bare private-network IPv4 address', () => {
    for (const host of ['192.168.10.1', '10.0.0.5', '172.16.4.2'])
      expect(falconPointerHostIssue(host)).toBeNull();
    for (const host of [
      '8.8.8.8',
      '127.0.0.1',
      'localhost',
      '192.168.10.1:80',
      '192.168.10.1/x',
      'user@192.168.10.1',
      'falcon.local',
      '',
    ])
      expect(falconPointerHostIssue(host)).not.toBeNull();
  });

  it('posts the switch as JSON and reports success', async () => {
    received.length = 0;
    status = 200;
    expect(await switchFalconPointer('127.0.0.1', true, falconPort)).toEqual({ kind: 'ok' });
    expect(await switchFalconPointer('127.0.0.1', false, falconPort)).toEqual({ kind: 'ok' });
    expect(received).toEqual([
      {
        method: 'POST',
        url: '/device/assistLight',
        type: 'application/json',
        body: '{"switch":1}',
      },
      {
        method: 'POST',
        url: '/device/assistLight',
        type: 'application/json',
        body: '{"switch":0}',
      },
    ]);
  });

  it('reports an HTTP error and a silent machine as failures', async () => {
    status = 500;
    expect(await switchFalconPointer('127.0.0.1', true, falconPort)).toEqual({
      kind: 'failed',
      reason: 'The Falcon answered HTTP 500.',
    });
    status = 200;
    silent = true;
    try {
      expect(await switchFalconPointer('127.0.0.1', true, falconPort, 200)).toEqual({
        kind: 'failed',
        reason: 'The Falcon at 127.0.0.1 did not answer within 0.2 s.',
      });
    } finally {
      silent = false;
    }
  });

  it('refuses a public host, a bad state and GET at the bridge without contacting anything', async () => {
    const before = received.length;
    const post = (query: string) =>
      fetch(`http://127.0.0.1:${bridge.port}/falcon/pointer?${query}`, {
        method: 'POST',
        headers: { Origin: TRUSTED_ORIGIN },
      });
    const publicHost = await post('host=8.8.8.8&state=on');
    expect(publicHost.status).toBe(400);
    expect(await publicHost.json()).toMatchObject({ kind: 'rejected' });
    expect((await post('host=192.168.10.1&state=blink')).status).toBe(400);
    const get = await fetch(
      `http://127.0.0.1:${bridge.port}/falcon/pointer?host=192.168.10.1&state=on`,
      { headers: { Origin: TRUSTED_ORIGIN } },
    );
    expect(get.status).toBe(405);
    const untrusted = await fetch(
      `http://127.0.0.1:${bridge.port}/falcon/pointer?host=192.168.10.1&state=on`,
      { method: 'POST', headers: { Origin: 'https://evil.example' } },
    );
    expect(untrusted.status).toBe(403);
    expect(received.length).toBe(before);
  });
});
