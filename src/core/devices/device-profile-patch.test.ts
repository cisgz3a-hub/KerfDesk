import { describe, expect, it } from 'vitest';
import { resolveEffectiveScanDirection } from '../job/scan-direction-policy';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from './device-profile';
import { deviceProfileWithInteractivePatch } from './device-profile-patch';

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
      reason: 'uncalibrated-profile-fallback',
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

  it('clears scan calibration when controller, dialect, or laser-head identity changes', () => {
    const calibrated = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: 'verified' as const,
    };
    for (const patch of [
      { controllerKind: 'grblhal' as const },
      { gcodeDialect: { dialectId: 'grbl-dynamic' as const } },
      {
        laserSubProfile: calibrated.laserSubProfile
          ? {
              ...calibrated.laserSubProfile,
              model: `${calibrated.laserSubProfile.model} replacement`,
            }
          : {
              model: 'replacement',
              focusMode: 'manual' as const,
              airAssist: 'none' as const,
            },
      },
    ]) {
      const changed = deviceProfileWithInteractivePatch(calibrated, patch);
      expect(changed.scanningOffsets).toEqual([]);
      expect(changed.scanOffsetCalibrationStatus).toBeUndefined();
    }
    expect(
      deviceProfileWithInteractivePatch(calibrated, { name: 'Renamed' }).scanningOffsets,
    ).toEqual(calibrated.scanningOffsets);
  });

  it('keeps a saved camera model across profile edits', () => {
    const cameraModel = {
      version: 1,
      lens: {
        intrinsics: { fx: 560, fy: 560, cx: 640, cy: 360 },
        distortion: [-0.02, 0.01, 0, 0],
        imageWidth: 1280,
        imageHeight: 720,
      },
      pose: { rvec: [0.1, 0, 0], tvec: [-200, -150, 380] },
      accuracy: {
        rmsErrorMm: 0.1,
        maxErrorMm: 0.3,
        foundMarks: 80,
        expectedMarks: 80,
        targetHeightMm: 3,
      },
      calibratedAt: '2026-09-26T12:00:00.000Z',
    } as const;
    const profile = { ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, cameraModel };

    const patched = deviceProfileWithInteractivePatch(profile, { maxFeed: 500 });

    expect(patched.cameraModel).toBe(cameraModel);
  });
});
