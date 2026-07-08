import { describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../core/camera';
import type { FrameCaptureIo } from './decode-jpeg';
import {
  captureSourceFrame,
  MACHINE_JPEG_POLL_INTERVAL_MS,
  sourcePollIntervalMs,
  withCacheBuster,
  type ActiveCameraSource,
} from './frame-source';

const FRAME: RgbaImage = {
  data: new Uint8ClampedArray([0, 0, 0, 255]),
  width: 1,
  height: 1,
};

const JPEG_SOURCE: ActiveCameraSource = {
  kind: 'machine-jpeg',
  frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=cam',
  cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
};

const RTSP_SOURCE: ActiveCameraSource = {
  kind: 'machine-rtsp',
  frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=rtsp',
  previewUrl: 'http://127.0.0.1:51731/stream.mjpg?url=rtsp',
};

function io(overrides?: Partial<FrameCaptureIo>): FrameCaptureIo {
  return {
    fetchBlob: async () => new Blob(['x']),
    decodeToRgba: async () => FRAME,
    ...overrides,
  };
}

describe('captureSourceFrame', () => {
  it('fetches machine-jpeg frames through the proxy with a cache-buster', async () => {
    const fetchBlob = vi.fn(async (_url: string) => new Blob(['x']));
    const frame = await captureSourceFrame(JPEG_SOURCE, io({ fetchBlob }));
    expect(frame).toBe(FRAME);
    expect(fetchBlob).toHaveBeenCalledTimes(1);
    const url = fetchBlob.mock.calls[0]?.[0] ?? '';
    expect(url.startsWith(`${JPEG_SOURCE.frameUrl}&t=`)).toBe(true);
  });

  it('fetches machine-rtsp stills from the single-frame proxy URL as-is', async () => {
    // The bridge decodes a fresh ffmpeg frame per request; no buster involved.
    const fetchBlob = vi.fn(async (_url: string) => new Blob(['x']));
    await captureSourceFrame(RTSP_SOURCE, io({ fetchBlob }));
    expect(fetchBlob).toHaveBeenCalledWith(RTSP_SOURCE.frameUrl);
  });

  it('resolves null when the fetch or the decode fails', async () => {
    expect(await captureSourceFrame(JPEG_SOURCE, io({ fetchBlob: async () => null }))).toBeNull();
    expect(
      await captureSourceFrame(JPEG_SOURCE, io({ decodeToRgba: async () => null })),
    ).toBeNull();
  });
});

describe('sourcePollIntervalMs', () => {
  it('maps each source kind to its frame cadence', () => {
    const usb: ActiveCameraSource = {
      kind: 'usb',
      stream: { stream: {} as MediaStream, stop: () => undefined },
    };
    expect(sourcePollIntervalMs(usb)).toBe(250);
    expect(sourcePollIntervalMs(JPEG_SOURCE)).toBe(MACHINE_JPEG_POLL_INTERVAL_MS);
    expect(sourcePollIntervalMs(RTSP_SOURCE)).toBe(500);
  });
});

describe('withCacheBuster', () => {
  it('appends with ? or & depending on an existing query', () => {
    expect(withCacheBuster('http://x/frame.jpg')).toMatch(/^http:\/\/x\/frame\.jpg\?t=\d+$/);
    expect(withCacheBuster('http://x/frame.jpg?url=y')).toMatch(
      /^http:\/\/x\/frame\.jpg\?url=y&t=\d+$/,
    );
  });
});
