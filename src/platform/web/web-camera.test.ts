import { afterEach, describe, expect, it, vi } from 'vitest';
import { findFirstNetworkCamera, networkCameraFrameUrl, webCamera } from './web-camera';

// Mock navigator with a fake mediaDevices. The casts exist only to satisfy the
// DOM lib types for a partial stub — runtime shape is all webCamera reads.
function stubNavigator(mediaDevices?: Partial<MediaDevices>): void {
  const nav = mediaDevices === undefined ? {} : { mediaDevices };
  vi.stubGlobal('navigator', nav as unknown as Navigator);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('webCamera', () => {
  it('reports unsupported when mediaDevices is absent', () => {
    stubNavigator(undefined);
    expect(webCamera.isSupported()).toBe(false);
  });

  it('reports supported when mediaDevices is present', () => {
    stubNavigator({ getUserMedia: vi.fn(), enumerateDevices: vi.fn() });
    expect(webCamera.isSupported()).toBe(true);
  });

  it('lists only video input devices', async () => {
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: 'videoinput', deviceId: 'cam1', label: 'Front' },
      { kind: 'audioinput', deviceId: 'mic1', label: 'Mic' },
      { kind: 'videoinput', deviceId: 'cam2', label: 'Rear' },
    ]);
    stubNavigator({ getUserMedia: vi.fn(), enumerateDevices });
    expect(await webCamera.listCameras()).toEqual([
      { deviceId: 'cam1', label: 'Front' },
      { deviceId: 'cam2', label: 'Rear' },
    ]);
  });

  it('returns [] from listCameras when unsupported', async () => {
    stubNavigator(undefined);
    expect(await webCamera.listCameras()).toEqual([]);
  });

  it('returns null when the user denies permission', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    stubNavigator({ getUserMedia, enumerateDevices: vi.fn() });
    expect(await webCamera.openStream()).toBeNull();
  });

  it('re-throws non-permission errors', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException('busy', 'NotReadableError'));
    stubNavigator({ getUserMedia, enumerateDevices: vi.fn() });
    await expect(webCamera.openStream()).rejects.toThrow();
  });

  it('opens the requested device and stop() releases every track', async () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    const stream = { getTracks: () => tracks } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubNavigator({ getUserMedia, enumerateDevices: vi.fn() });

    const result = await webCamera.openStream('cam1');
    expect(result).not.toBeNull();
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { ideal: 'cam1' } },
      audio: false,
    });

    result!.stop();
    expect(tracks[0]!.stop).toHaveBeenCalledTimes(1);
    expect(tracks[1]!.stop).toHaveBeenCalledTimes(1);
  });

  it('requests the default camera when no deviceId is given', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubNavigator({ getUserMedia, enumerateDevices: vi.fn() });
    await webCamera.openStream();
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
  });

  it('requests the default camera when the deviceId is blank (pre-permission)', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    stubNavigator({ getUserMedia, enumerateDevices: vi.fn() });
    await webCamera.openStream('');
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: false });
  });

  it('retries with the default camera when a deviceId over-constrains', async () => {
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('bad device', 'OverconstrainedError'))
      .mockResolvedValueOnce(stream);
    stubNavigator({ getUserMedia, enumerateDevices: vi.fn() });
    const result = await webCamera.openStream('stale-id');
    expect(result).not.toBeNull();
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      video: { deviceId: { ideal: 'stale-id' } },
      audio: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: true, audio: false });
  });
});

describe('network camera discovery', () => {
  it('builds the Falcon frame URL', () => {
    expect(networkCameraFrameUrl('192.168.10.1')).toBe(
      'http://192.168.10.1:8080/media/getCapturePhoto',
    );
  });

  it('returns the first reachable candidate and stops probing', async () => {
    const probe = vi.fn(async (url: string) => url.includes('192.168.10.254'));
    const result = await findFirstNetworkCamera(
      ['192.168.10.1', '192.168.10.254', '192.168.10.2'],
      probe,
    );
    expect(result).toBe('http://192.168.10.254:8080/media/getCapturePhoto');
    expect(probe).toHaveBeenCalledTimes(2); // .1 missed, .254 hit, .2 not tried
  });

  it('returns null when no candidate responds', async () => {
    const probe = vi.fn(async () => false);
    expect(await findFirstNetworkCamera(['192.168.10.1', '192.168.10.254'], probe)).toBeNull();
  });
});
