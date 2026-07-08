import { describe, expect, it } from 'vitest';
import {
  cameraBridgeCorsOrigin,
  completeRtspDescribeResponse,
  isAllowedBridgeOrigin,
  rtspProbeIsOk,
} from './rtsp-camera-bridge';

describe('RTSP camera bridge request policy', () => {
  it('allows LaserForge app origins and rejects unrelated websites', () => {
    expect(cameraBridgeCorsOrigin('app://app')).toBe('app://app');
    expect(cameraBridgeCorsOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    // Any loopback port: Vite falls back to a random port when 5173 is taken.
    expect(cameraBridgeCorsOrigin('http://localhost:55585')).toBe('http://localhost:55585');
    expect(cameraBridgeCorsOrigin('http://127.0.0.1:4000')).toBe('http://127.0.0.1:4000');
    // Loopback must still be http and truly loopback.
    expect(cameraBridgeCorsOrigin('http://evil-localhost.example')).toBeNull();
    expect(cameraBridgeCorsOrigin('http://192.168.2.171:5173')).toBeNull();
    expect(cameraBridgeCorsOrigin('https://kerfdesk.com')).toBe('https://kerfdesk.com');
    expect(cameraBridgeCorsOrigin('https://laserforge-2fj.pages.dev')).toBe(
      'https://laserforge-2fj.pages.dev',
    );
    expect(cameraBridgeCorsOrigin('https://5e8ad38c.laserforge-2fj.pages.dev')).toBe(
      'https://5e8ad38c.laserforge-2fj.pages.dev',
    );
    expect(cameraBridgeCorsOrigin('https://example.com')).toBeNull();
  });

  it('gates request side effects server-side by Origin (S03-001)', () => {
    // CORS only stops a browser reading the response; the request's side effects
    // (RTSP probe / ffmpeg spawn) still fire. So the server must refuse an
    // untrusted browser Origin BEFORE doing any work.
    expect(isAllowedBridgeOrigin(undefined)).toBe(true); // same-origin / non-browser local client
    expect(isAllowedBridgeOrigin('app://app')).toBe(true);
    expect(isAllowedBridgeOrigin('https://kerfdesk.com')).toBe(true);
    expect(isAllowedBridgeOrigin('https://evil.example')).toBe(false); // drive-by page — refused
  });

  it('treats only successful RTSP DESCRIBE replies as reachable', () => {
    expect(rtspProbeIsOk('RTSP/1.0 200 OK\r\n\r\nv=0')).toBe(true);
    expect(rtspProbeIsOk('RTSP/1.0 404 Not Found\r\n\r\n')).toBe(false);
    expect(rtspProbeIsOk('')).toBe(false);
  });

  it('recognizes a complete DESCRIBE response before the socket closes', () => {
    expect(completeRtspDescribeResponse(Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n'))).toBe(
      'RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n',
    );

    expect(
      completeRtspDescribeResponse(
        Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 3\r\n\r\nv=0'),
      ),
    ).toBe('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 3\r\n\r\nv=0');

    expect(
      completeRtspDescribeResponse(
        Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 3\r\n\r\nv='),
      ),
    ).toBeNull();
  });
});
