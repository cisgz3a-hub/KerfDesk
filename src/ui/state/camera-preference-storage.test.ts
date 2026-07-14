import { beforeEach, describe, expect, it } from 'vitest';
import {
  loadRtspCameraUrl,
  rtspUrlWithoutCredentials,
  saveRtspCameraUrl,
} from './camera-preference-storage';

beforeEach(() => localStorage.clear());

describe('RTSP camera preference security', () => {
  it('never persists username or password', () => {
    saveRtspCameraUrl('rtsp://operator:secret@192.168.1.20/live');
    expect(loadRtspCameraUrl()).toBe('rtsp://192.168.1.20/live');
    expect(localStorage.getItem('laserforge.camera.rtspUrl.v1')).toBe('rtsp://192.168.1.20/live');
  });

  it('scrubs credentials from a legacy stored preference on read', () => {
    localStorage.setItem(
      'laserforge.camera.rtspUrl.v1',
      'rtsp://old-user:old-password@192.168.1.21/stream',
    );
    expect(loadRtspCameraUrl()).toBe('rtsp://192.168.1.21/stream');
    expect(localStorage.getItem('laserforge.camera.rtspUrl.v1')).toBe('rtsp://192.168.1.21/stream');
  });

  it('best-effort scrubs malformed URL-like input', () => {
    expect(rtspUrlWithoutCredentials('rtsp://user:password@camera/live bad')).not.toContain(
      'password',
    );
  });
});
