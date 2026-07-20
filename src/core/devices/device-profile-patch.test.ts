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
});
