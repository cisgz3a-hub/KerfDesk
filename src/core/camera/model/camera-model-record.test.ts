import { describe, expect, it } from 'vitest';
import { bedPoint, cameraCentre, projectWorldPoint } from './camera-model';
import {
  cameraModelHeightMm,
  lensForFrame,
  normalizeCameraModelRecord,
  type CameraModelRecord,
} from './camera-model-record';
import { overheadPose, wideLens } from './model-fixtures';

const record: CameraModelRecord = {
  version: 1,
  lens: wideLens(1280),
  pose: overheadPose(),
  capture: {
    version: 1,
    sourceKind: 'usb',
    sourceId: 'usb:overhead',
    width: 1280,
    height: 720,
    resizeMode: 'none',
  },
  accuracy: {
    rmsErrorMm: 0.08,
    maxErrorMm: 0.21,
    foundMarks: 98,
    expectedMarks: 100,
    targetHeightMm: 3,
  },
  calibratedAt: '2026-09-26T15:00:00.000Z',
};

describe('normalizeCameraModelRecord', () => {
  it('round-trips a saved record through JSON', () => {
    const restored = normalizeCameraModelRecord(JSON.parse(JSON.stringify(record)));
    expect(restored).toEqual(record);
  });

  it('keeps a record saved without a capture binding', () => {
    const { capture: _capture, ...unbound } = record;
    expect(normalizeCameraModelRecord(unbound)).toEqual(unbound);
  });

  it.each([
    ['a missing version', { ...record, version: undefined }],
    [
      'a non-finite focal length',
      {
        ...record,
        lens: { ...record.lens, intrinsics: { ...record.lens.intrinsics, fx: Number.NaN } },
      },
    ],
    ['a short distortion list', { ...record, lens: { ...record.lens, distortion: [0, 0, 0] } }],
    ['a pose without translation', { ...record, pose: { rvec: record.pose.rvec } }],
    ['a negative error', { ...record, accuracy: { ...record.accuracy, rmsErrorMm: -1 } }],
    ['an empty calibration time', { ...record, calibratedAt: '' }],
    ['a broken capture binding', { ...record, capture: { version: 2 } }],
  ])('rejects %s', (_label, value) => {
    expect(normalizeCameraModelRecord(value)).toBeUndefined();
  });
});

describe('lensForFrame', () => {
  it('returns the calibrated lens for a frame of the calibrated size', () => {
    expect(lensForFrame(record, 1280, 720)).toBe(record.lens);
  });

  it('rescales the lens for a smaller frame of the same shape', () => {
    const half = lensForFrame(record, 640, 360);
    expect(half).not.toBeNull();
    const world = bedPoint(120, 260, 3);
    const full = projectWorldPoint(record.lens, record.pose, world);
    const scaled = projectWorldPoint(half ?? record.lens, record.pose, world);
    // Pixel centres: (x + 0.5) scales with the frame.
    expect((scaled?.x ?? 0) + 0.5).toBeCloseTo(((full?.x ?? 0) + 0.5) / 2, 9);
    expect((scaled?.y ?? 0) + 0.5).toBeCloseTo(((full?.y ?? 0) + 0.5) / 2, 9);
  });

  it('refuses a frame cropped to another shape', () => {
    expect(lensForFrame(record, 960, 720)).toBeNull();
    expect(lensForFrame(record, 0, 720)).toBeNull();
  });
});

describe('cameraModelHeightMm', () => {
  it('is the camera centre above the bed', () => {
    expect(cameraModelHeightMm(record)).toBeCloseTo(-cameraCentre(record.pose).z, 9);
    expect(cameraModelHeightMm(record)).toBeGreaterThan(0);
  });
});
