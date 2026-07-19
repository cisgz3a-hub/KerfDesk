import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { resolveEffectiveScanDirection } from './scan-direction-policy';

describe('resolveEffectiveScanDirection', () => {
  it('preserves generic/Falcon-style requested direction', () => {
    expect(resolveEffectiveScanDirection(DEFAULT_DEVICE_PROFILE, true)).toEqual({
      bidirectional: true,
      reason: 'requested-bidirectional',
    });
    expect(resolveEffectiveScanDirection(DEFAULT_DEVICE_PROFILE, false)).toEqual({
      bidirectional: false,
      reason: 'requested-one-way',
    });
  });

  it('falls back only for an uncalibrated 4040 unless explicitly overridden', () => {
    expect(resolveEffectiveScanDirection(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, true)).toEqual({
      bidirectional: false,
      reason: 'uncalibrated-4040-fallback',
    });
    expect(
      resolveEffectiveScanDirection(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, true, true),
    ).toEqual({ bidirectional: true, reason: 'expert-override' });
    expect(
      resolveEffectiveScanDirection(
        {
          ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
          scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 0.1 }],
        },
        true,
      ),
    ).toEqual({ bidirectional: true, reason: 'calibrated-bidirectional' });
  });

  it('keeps normal 4040 jobs one-way while a newly measured table is pending', () => {
    const pending = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: 'pending' as const,
    };

    expect(resolveEffectiveScanDirection(pending, true)).toEqual({
      bidirectional: false,
      reason: 'pending-calibration-4040-fallback',
    });
    expect(resolveEffectiveScanDirection(pending, true, true)).toEqual({
      bidirectional: false,
      reason: 'pending-calibration-4040-fallback',
    });
  });

  it('allows verified and legacy nonempty tables for normal 4040 jobs', () => {
    const table = [{ speedMmPerMin: 1500, offsetMm: 0.1 }];
    expect(
      resolveEffectiveScanDirection(
        {
          ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
          scanningOffsets: table,
          scanOffsetCalibrationStatus: 'verified',
        },
        true,
      ),
    ).toEqual({ bidirectional: true, reason: 'calibrated-bidirectional' });
    expect(
      resolveEffectiveScanDirection(
        { ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, scanningOffsets: table },
        true,
      ),
    ).toEqual({ bidirectional: true, reason: 'calibrated-bidirectional' });
  });

  it('reserves bidirectional pending output for the verification coupon', () => {
    const pending = {
      ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1500, offsetMm: 0.1 }],
      scanOffsetCalibrationStatus: 'pending' as const,
    };

    expect(resolveEffectiveScanDirection(pending, true, false, 'verification')).toEqual({
      bidirectional: true,
      reason: 'calibration-verification',
    });
  });
});
