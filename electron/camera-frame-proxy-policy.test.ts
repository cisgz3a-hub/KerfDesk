import { describe, expect, it } from 'vitest';
import { cameraFrameUrlPolicy } from './camera-frame-proxy-policy';

const BRIDGE_PORT = 51731;

describe('camera frame proxy URL policy', () => {
  it('allows Falcon-style private HTTP snapshot URLs', () => {
    const result = cameraFrameUrlPolicy(
      'http://192.168.10.1:8080/media/getCapturePhoto',
      BRIDGE_PORT,
    );
    expect(result).toEqual({
      kind: 'ok',
      url: new URL('http://192.168.10.1:8080/media/getCapturePhoto'),
      transport: 'http',
    });
  });

  it('allows private RTSP URLs as single-frame sources', () => {
    const result = cameraFrameUrlPolicy('rtsp://192.168.10.1:8554/', BRIDGE_PORT);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.transport).toBe('rtsp');
  });

  it('rejects public hosts and non-camera protocols', () => {
    expect(cameraFrameUrlPolicy('http://example.com/frame.jpg', BRIDGE_PORT).kind).toBe('invalid');
    expect(cameraFrameUrlPolicy('http://8.8.8.8/frame.jpg', BRIDGE_PORT).kind).toBe('invalid');
    expect(cameraFrameUrlPolicy('file:///C:/secret.txt', BRIDGE_PORT).kind).toBe('invalid');
    expect(cameraFrameUrlPolicy('ftp://192.168.10.1/frame.jpg', BRIDGE_PORT).kind).toBe('invalid');
    expect(cameraFrameUrlPolicy('not a url', BRIDGE_PORT).kind).toBe('invalid');
  });

  it('rejects proxying the bridge itself (recursion guard)', () => {
    expect(
      cameraFrameUrlPolicy(`http://127.0.0.1:${BRIDGE_PORT}/frame.jpg?url=x`, BRIDGE_PORT),
    ).toEqual({ kind: 'invalid', reason: 'Camera frame proxy cannot proxy itself.' });
    expect(cameraFrameUrlPolicy(`http://localhost:${BRIDGE_PORT}/health`, BRIDGE_PORT).kind).toBe(
      'invalid',
    );
    // Loopback on a different port stays allowed (e.g. a local test camera).
    expect(cameraFrameUrlPolicy('http://127.0.0.1:8080/frame.jpg', BRIDGE_PORT).kind).toBe('ok');
  });
});
