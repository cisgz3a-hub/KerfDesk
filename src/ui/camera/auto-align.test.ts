import { describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../core/camera';
import type { FrameCaptureIo } from './decode-jpeg';
import type { ActiveCameraSource } from './frame-source';
import { runAutoAlign } from './auto-align';

const SOURCE: ActiveCameraSource = {
  kind: 'machine-jpeg',
  frameUrl: 'http://127.0.0.1:51731/frame.jpg?url=cam',
  cameraUrl: 'http://192.168.10.1:8080/media/getCapturePhoto',
};

function grayFrame(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 128;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function io(frame: RgbaImage | null): FrameCaptureIo {
  return {
    fetchBlob: async () => (frame === null ? null : new Blob(['x'])),
    decodeToRgba: async () => frame,
  };
}

describe('runAutoAlign', () => {
  it('fails typed when no frame can be captured, without persisting', async () => {
    const updateDeviceProfile = vi.fn();
    const outcome = await runAutoAlign({
      source: SOURCE,
      calibration: undefined,
      bedWidth: 400,
      bedHeight: 400,
      updateDeviceProfile,
      io: io(null),
    });
    expect(outcome).toEqual({ kind: 'failed', message: 'Could not capture a camera frame.' });
    expect(updateDeviceProfile).not.toHaveBeenCalled();
  });

  it('fails with the markers-not-found copy on a blank frame, without persisting', async () => {
    const updateDeviceProfile = vi.fn();
    const outcome = await runAutoAlign({
      source: SOURCE,
      calibration: undefined,
      bedWidth: 400,
      bedHeight: 400,
      updateDeviceProfile,
      io: io(grayFrame(320, 240)),
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.message).toContain('Markers not found');
    expect(updateDeviceProfile).not.toHaveBeenCalled();
  });
});
