import { describe, expect, it } from 'vitest';
import {
  cameraBridgeCorsOrigin,
  completeRtspDescribeResponse,
  rtspProbeIsOk,
} from './rtsp-camera-bridge';

describe('RTSP camera bridge request policy', () => {
  it('allows LaserForge app origins and rejects unrelated websites', () => {
    expect(cameraBridgeCorsOrigin('app://app')).toBe('app://app');
    expect(cameraBridgeCorsOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(cameraBridgeCorsOrigin('https://kerfdesk.com')).toBe('https://kerfdesk.com');
    expect(cameraBridgeCorsOrigin('https://laserforge-2fj.pages.dev')).toBe(
      'https://laserforge-2fj.pages.dev',
    );
    expect(cameraBridgeCorsOrigin('https://5e8ad38c.laserforge-2fj.pages.dev')).toBe(
      'https://5e8ad38c.laserforge-2fj.pages.dev',
    );
    expect(cameraBridgeCorsOrigin('https://example.com')).toBeNull();
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
