import { describe, expect, it, vi } from 'vitest';
import type { CameraCalibration, RgbaImage } from '../../core/camera';
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

const OTHER_CAMERA_CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 200, fy: 200, cx: 160, cy: 120 },
  distortion: [0, 0, 0, 0],
  imageWidth: 320,
  imageHeight: 240,
  rmsPx: 0.2,
  calibratedAt: 1,
  capture: {
    version: 1,
    sourceKind: 'machine-jpeg',
    sourceId: 'http://192.168.10.2/frame.jpg',
    width: 320,
    height: 240,
    resizeMode: 'unknown',
  },
};

describe('runAutoAlign', () => {
  it('fails typed when no frame can be captured, without persisting', async () => {
    const updateDeviceProfile = vi.fn();
    const outcome = await runAutoAlign({
      source: SOURCE,
      calibration: undefined,
      bedWidth: 400,
      bedHeight: 400,
      planeHeightMm: 0,
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
      planeHeightMm: 0,
      updateDeviceProfile,
      io: io(grayFrame(320, 240)),
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.message).toContain('Markers not found');
    expect(updateDeviceProfile).not.toHaveBeenCalled();
  });

  it('refuses lens calibration from another camera before solving alignment', async () => {
    const updateDeviceProfile = vi.fn();
    const outcome = await runAutoAlign({
      source: SOURCE,
      calibration: OTHER_CAMERA_CALIBRATION,
      bedWidth: 400,
      bedHeight: 400,
      planeHeightMm: 0,
      updateDeviceProfile,
      io: io(grayFrame(320, 240)),
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') expect(outcome.message).toContain('different camera');
    expect(updateDeviceProfile).not.toHaveBeenCalled();
  });
});
