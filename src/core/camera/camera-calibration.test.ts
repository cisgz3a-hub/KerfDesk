import { describe, expect, it } from 'vitest';
import {
  type CameraCalibration,
  normalizeCameraCalibration,
  toCameraCalibration,
} from './camera-calibration';

const VALID: CameraCalibration = {
  intrinsics: { fx: 900, fy: 890, cx: 955, cy: 545 },
  distortion: [0.08, -0.01, 0.004, -0.0005],
  imageWidth: 1920,
  imageHeight: 1080,
  rmsPx: 0.32,
  calibratedAt: 1782648000000,
};

describe('normalizeCameraCalibration', () => {
  it('accepts and round-trips a valid calibration', () => {
    expect(normalizeCameraCalibration(VALID)).toEqual(VALID);
  });

  it('accepts a structurally valid clone parsed from JSON', () => {
    expect(normalizeCameraCalibration(JSON.parse(JSON.stringify(VALID)))).toEqual(VALID);
  });

  it.each([
    ['null', null],
    ['a string', 'nope'],
    ['missing distortion', { ...VALID, distortion: undefined }],
    ['distortion of wrong length', { ...VALID, distortion: [0.1, 0.2, 0.3] }],
    [
      'a non-finite intrinsic',
      { ...VALID, intrinsics: { fx: Number.NaN, fy: 890, cx: 955, cy: 545 } },
    ],
    ['a non-positive focal', { ...VALID, intrinsics: { ...VALID.intrinsics, fx: 0 } }],
    ['a negative rms', { ...VALID, rmsPx: -1 }],
    ['a zero image width', { ...VALID, imageWidth: 0 }],
    ['a missing timestamp', { ...VALID, calibratedAt: undefined }],
  ])('rejects %s', (_label, input) => {
    expect(normalizeCameraCalibration(input)).toBeUndefined();
  });
});

describe('toCameraCalibration', () => {
  it('maps a solved snapshot and stamps the supplied time, surviving normalisation', () => {
    const built = toCameraCalibration(
      {
        intrinsics: VALID.intrinsics,
        distortion: VALID.distortion,
        imageWidth: VALID.imageWidth,
        imageHeight: VALID.imageHeight,
        rmsPx: VALID.rmsPx,
      },
      VALID.calibratedAt,
    );
    expect(built).toEqual(VALID);
    expect(normalizeCameraCalibration(built)).toEqual(VALID);
  });
});
