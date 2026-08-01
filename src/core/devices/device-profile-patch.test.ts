import { describe, expect, it } from 'vitest';
import type { CameraAlignment, CameraCalibration } from '../camera';
import { resolveEffectiveScanDirection } from '../job/scan-direction-policy';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from './device-profile';
import { deviceProfileWithInteractivePatch } from './device-profile-patch';

const CAMERA_CALIBRATION: CameraCalibration = {
  intrinsics: { fx: 800, fy: 800, cx: 320, cy: 240 },
  distortion: [0, 0, 0, 0],
  imageWidth: 640,
  imageHeight: 480,
  rmsPx: 0.4,
  calibratedAt: 1,
};

const RECTIFIED_ALIGNMENT: CameraAlignment = {
  homography: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  frameWidth: 640,
  frameHeight: 480,
  basis: 'rectified',
  alignedAt: 1,
};

describe('deviceProfileWithInteractivePatch', () => {
  it('clears calibration that becomes invalid after an interactive bed resize', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 3 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const resized = deviceProfileWithInteractivePatch(calibrated, {
      bedWidth: 100,
      bedHeight: 100,
    });

    expect(resized.scanningOffsets).toEqual([]);
    expect(resized.scanOffsetCalibrationStatus).toBeUndefined();
    expect(resolveEffectiveScanDirection(resized, true)).toEqual({
      bidirectional: false,
      reason: 'uncalibrated-4040-fallback',
    });
  });

  it('retains valid calibration while preserving max-feed clamping', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 3 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const patched = deviceProfileWithInteractivePatch(calibrated, { maxFeed: 500 });

    expect(patched.scanningOffsets).toEqual(calibrated.scanningOffsets);
    expect(patched.scanOffsetCalibrationStatus).toBe('verified');
    expect(patched.controlledLaserOffTravelFeedMmPerMin).toBe(500);
  });

  it('clears lifecycle status when the interactive table is emptied', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };

    const cleared = deviceProfileWithInteractivePatch(calibrated, { scanningOffsets: [] });

    expect(cleared.scanningOffsets).toEqual([]);
    expect(cleared.scanOffsetCalibrationStatus).toBeUndefined();
  });

  it('clears a rectified camera alignment when lens calibration changes', () => {
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const recalibrated = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: { ...CAMERA_CALIBRATION, calibratedAt: 2 },
    });

    expect(recalibrated.cameraCalibration?.calibratedAt).toBe(2);
    expect(recalibrated.cameraAlignment).toBeUndefined();
  });

  it('retains a raw camera alignment when lens calibration changes', () => {
    const rawAlignment = { ...RECTIFIED_ALIGNMENT, basis: 'raw' as const };
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: rawAlignment,
    };

    const recalibrated = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: { ...CAMERA_CALIBRATION, calibratedAt: 2 },
    });

    expect(recalibrated.cameraAlignment).toBe(rawAlignment);
  });

  it('retains a rectified camera alignment for unrelated profile edits', () => {
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const renamed = deviceProfileWithInteractivePatch(profile, { name: 'Renamed profile' });

    expect(renamed.cameraAlignment).toBe(RECTIFIED_ALIGNMENT);
  });

  it('retains a rectified alignment when the calibration value is unchanged', () => {
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const unchanged = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: CAMERA_CALIBRATION,
    });

    expect(unchanged.cameraAlignment).toBe(RECTIFIED_ALIGNMENT);
  });

  it('retains a rectified alignment supplied with its replacement calibration', () => {
    const replacementAlignment = { ...RECTIFIED_ALIGNMENT, alignedAt: 2 };
    const profile = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      cameraCalibration: CAMERA_CALIBRATION,
      cameraAlignment: RECTIFIED_ALIGNMENT,
    };

    const replacedPair = deviceProfileWithInteractivePatch(profile, {
      cameraCalibration: { ...CAMERA_CALIBRATION, calibratedAt: 2 },
      cameraAlignment: replacementAlignment,
    });

    expect(replacedPair.cameraAlignment).toBe(replacementAlignment);
  });
});
