import { describe, expect, it } from 'vitest';
import { rtspCameraUrlPolicy } from './rtsp-camera-bridge-policy';

describe('RTSP camera bridge URL policy', () => {
  it('allows CV40PRO-style private RTSP URLs', () => {
    expect(rtspCameraUrlPolicy('rtsp://192.168.10.1:8554/')).toEqual({
      kind: 'ok',
      url: new URL('rtsp://192.168.10.1:8554/'),
    });
    expect(rtspCameraUrlPolicy('rtsp://10.0.0.5/live').kind).toBe('ok');
    expect(rtspCameraUrlPolicy('rtsp://172.16.4.2/stream').kind).toBe('ok');
  });

  it('rejects non-RTSP and public-network URLs', () => {
    expect(rtspCameraUrlPolicy('http://192.168.10.1:8080/')).toEqual({
      kind: 'invalid',
      reason: 'Camera bridge accepts only rtsp:// URLs.',
    });
    expect(rtspCameraUrlPolicy('rtsp://8.8.8.8/live')).toEqual({
      kind: 'invalid',
      reason: 'Camera bridge accepts only loopback or private-network RTSP hosts.',
    });
  });

  it('rejects malformed private-looking IPv4 hosts', () => {
    expect(rtspCameraUrlPolicy('rtsp://10.999.1.1/live')).toEqual({
      kind: 'invalid',
      reason: 'Camera bridge accepts only loopback or private-network RTSP hosts.',
    });
    expect(rtspCameraUrlPolicy('rtsp://192.168.1/live')).toEqual({
      kind: 'invalid',
      reason: 'Camera bridge accepts only loopback or private-network RTSP hosts.',
    });
  });
});
