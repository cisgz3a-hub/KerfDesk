// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { rtspAuthorization, rtspRequestUri } from './rtsp-describe-auth';
import {
  probeRtsp,
  RTSP_LOGIN_REFUSED_REASON,
  RTSP_NEEDS_LOGIN_REASON,
  RTSP_LOGIN_UNSUPPORTED_REASON,
} from './rtsp-probe';

const SDP = 'v=0\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\n';
const OK = `RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: ${SDP.length}\r\n\r\n${SDP}`;
const DIGEST_401 =
  'RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Digest realm="IP Camera", nonce="3f1c9a"\r\nContent-Length: 0\r\n\r\n';

// Answers each request with the next scripted reply on the same connection,
// and keeps what was sent and how many connections were opened.
function scriptedCamera(replies: ReadonlyArray<string>) {
  const sent: string[] = [];
  let connections = 0;
  const createSocket = (): Socket => {
    const socket = new EventEmitter() as EventEmitter & Record<string, unknown>;
    connections += 1;
    Object.assign(socket, {
      destroy: vi.fn(() => socket),
      setTimeout: vi.fn(() => socket),
      connect: vi.fn((_port: number, _host: string, listener: () => void) => {
        listener();
        return socket;
      }),
      write: vi.fn((text: string) => {
        const reply = replies[sent.length] ?? '';
        sent.push(text);
        queueMicrotask(() => socket.emit('data', Buffer.from(reply)));
        return true;
      }),
    });
    return socket as unknown as Socket;
  };
  return { sent, createSocket, connections: () => connections };
}

describe('RTSP probe login (camera audit 2026-11-02)', () => {
  it('keeps the login out of the request line and answers the Digest challenge', async () => {
    const camera = scriptedCamera([DIGEST_401, OK]);
    const url = new URL('rtsp://admin:p%40ss@192.168.1.20:554/stream1');

    await expect(probeRtsp(url, camera.createSocket)).resolves.toEqual({ codec: 'H264' });

    expect(camera.sent).toHaveLength(2);
    // A camera may tie its nonce to the connection, so the repeat reuses it.
    expect(camera.connections()).toBe(1);
    for (const request of camera.sent) {
      expect(request.startsWith('DESCRIBE rtsp://192.168.1.20:554/stream1 RTSP/1.0\r\n')).toBe(
        true,
      );
      expect(request).not.toContain('p%40ss');
      expect(request).not.toContain('p@ss');
    }
    expect(camera.sent[0]).not.toContain('Authorization');
    expect(camera.sent[1]).toContain('CSeq: 2\r\n');
    expect(camera.sent[1]).toMatch(
      /Authorization: Digest username="admin", realm="IP Camera", nonce="3f1c9a", uri="rtsp:\/\/192\.168\.1\.20:554\/stream1", response="[0-9a-f]{32}"/,
    );
  });

  it('says the camera needs a login when the address has none', async () => {
    const camera = scriptedCamera([DIGEST_401]);
    await expect(
      probeRtsp(new URL('rtsp://192.168.1.20/stream1'), camera.createSocket),
    ).rejects.toThrow(RTSP_NEEDS_LOGIN_REASON);
    expect(camera.sent).toHaveLength(1);
  });

  it('says the login was refused when the camera answers 401 again', async () => {
    const camera = scriptedCamera([DIGEST_401, DIGEST_401]);
    await expect(
      probeRtsp(new URL('rtsp://admin:wrong@192.168.1.20/stream1'), camera.createSocket),
    ).rejects.toThrow(RTSP_LOGIN_REFUSED_REASON);
  });

  it('answers a Basic-only challenge with Basic', async () => {
    const basic401 =
      'RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Basic realm="cam"\r\n\r\n';
    const camera = scriptedCamera([basic401, OK]);
    await probeRtsp(new URL('rtsp://admin:secret@192.168.1.20/s'), camera.createSocket);
    expect(camera.sent[1]).toContain(
      `Authorization: Basic ${Buffer.from('admin:secret').toString('base64')}\r\n`,
    );
  });

  it('names a login it cannot send, and never sends Basic in place of a Digest', async () => {
    const oddDigest =
      'RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Digest realm="cam", nonce="n", algorithm=SHA-512-256\r\nWWW-Authenticate: Basic realm="cam"\r\n\r\n';
    const camera = scriptedCamera([oddDigest]);
    await expect(
      probeRtsp(new URL('rtsp://admin:secret@192.168.1.20/s'), camera.createSocket),
    ).rejects.toThrow(RTSP_LOGIN_UNSUPPORTED_REASON);
    expect(camera.sent).toHaveLength(1);
  });

  it('sends an address without a login unchanged', async () => {
    const camera = scriptedCamera([OK]);
    await probeRtsp(new URL('rtsp://192.168.10.1:8554/'), camera.createSocket);
    expect(camera.sent[0]).toBe(
      'DESCRIBE rtsp://192.168.10.1:8554/ RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\n\r\n',
    );
  });
});

describe('rtspAuthorization', () => {
  // RFC 2617 §3.5's worked example: an independent check of the Digest maths.
  it('matches the RFC 2617 qop=auth example', () => {
    const challenge =
      'RTSP/1.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"\r\n\r\n';
    const header = rtspAuthorization(
      challenge,
      { username: 'Mufasa', password: 'Circle Of Life' },
      'GET',
      '/dir/index.html',
      '0a4f113b',
    );
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(header).toContain('qop=auth, nc=00000001, cnonce="0a4f113b"');
    expect(header).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
  });

  // RFC 7616 §3.9.1's worked example, for the SHA-256 answer.
  it('matches the RFC 7616 SHA-256 example', () => {
    const challenge =
      'RTSP/1.0 401 Unauthorized\r\nWWW-Authenticate: Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=SHA-256, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"\r\n\r\n';
    const header = rtspAuthorization(
      challenge,
      { username: 'Mufasa', password: 'Circle of Life' },
      'GET',
      '/dir/index.html',
      'f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ',
    );
    expect(header).toContain(
      'response="753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"',
    );
  });

  it('answers Digest, not Basic, when a camera offers both', () => {
    const both =
      'RTSP/1.0 401 Unauthorized\r\nWWW-Authenticate: Basic realm="cam"\r\nWWW-Authenticate: Digest realm="cam", nonce="n"\r\n\r\n';
    expect(
      rtspAuthorization(both, { username: 'u', password: 'p' }, 'DESCRIBE', 'rtsp://h/s'),
    ).toMatch(/^Digest /);
  });

  it('strips only the login from the request URI', () => {
    expect(rtspRequestUri(new URL('rtsp://u:p@10.0.0.5:8554/live?ch=1'))).toBe(
      'rtsp://10.0.0.5:8554/live?ch=1',
    );
  });
});
