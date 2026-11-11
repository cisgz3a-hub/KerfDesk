// @vitest-environment node
// The bridge's /frame.jpg leaves a camera alone after a refused login, however
// many views keep asking (ADR-692 Amendment 1). A stand-in camera on
// 127.0.0.1; the loopback refusal in the address policy is lifted for it only.
import { createServer, type Server } from 'node:http';
import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./camera-frame-proxy-policy.js', () => ({
  cameraFrameUrlPolicy: (value: string) => ({ kind: 'ok', url: new URL(value), transport: 'http' }),
}));

import { handleFrameRequest, handleFrameSourceRequest } from './camera-frame-proxy';
import { CameraFrameSources } from './camera-frame-sources';

const SECRET = 'stand-in-secret-0';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function response() {
  const sent: { status: number; body: unknown }[] = [];
  let status = 0;
  const res = {
    writeHead: (code: number) => {
      status = code;
      return res;
    },
    end: (body?: string) => {
      sent.push({ status, body: body === undefined ? undefined : JSON.parse(body) });
    },
  };
  return { res: res as unknown as ServerResponse, sent };
}

describe('a camera that refuses the login', () => {
  it('is asked once, not on every picture the views poll for, until connected again', async () => {
    let asked = 0;
    const camera = createServer((_req, res) => {
      asked += 1;
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="phone"' }).end('login');
    });
    await new Promise<void>((resolve) => camera.listen(0, '127.0.0.1', resolve));
    servers.push(camera);
    const port = (camera.address() as AddressInfo).port;
    const url = `http://viewer:${SECRET}@127.0.0.1:${port}/shot.jpg`;
    const sources = new CameraFrameSources();
    const registered = response();
    handleFrameSourceRequest(url, registered.res, 51731, sources);
    const frameUrl = (registered.sent[0]?.body as { frameUrl: string }).frameUrl;
    const id = new URL(frameUrl).searchParams.get('source') ?? '';

    const answers: unknown[] = [];
    for (let poll = 0; poll < 20; poll += 1) {
      const picture = response();
      await handleFrameRequest(new URL(frameUrl), picture.res, 51731, sources);
      answers.push(picture.sent[0]?.body);
    }
    // One look without a login, one with it, then nothing more.
    expect(asked).toBe(2);
    expect(answers.at(-1)).toMatchObject({ kind: 'unavailable', login: 'refused' });
    expect(JSON.stringify(answers)).not.toContain(SECRET);

    // Connecting again asks the camera afresh.
    handleFrameSourceRequest(url, response().res, 51731, sources);
    await handleFrameRequest(new URL(frameUrl), response().res, 51731, sources);
    expect(asked).toBe(4);
    expect(sources.cameraUrl(id)).toBe(url);
  });
});
