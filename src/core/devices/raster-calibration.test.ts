import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RASTER_CALIBRATION,
  normalizeRasterCalibration,
  resolveRasterScanCalibration,
  scanAxisOffsetForDirection,
} from './raster-calibration';

describe('raster scan calibration', () => {
  it('defaults to disabled calibration with no row shift', () => {
    expect(normalizeRasterCalibration(undefined)).toEqual(DEFAULT_RASTER_CALIBRATION);
    expect(resolveRasterScanCalibration(undefined, 800)).toEqual({
      initialXOffsetMm: 0,
      bidirectionalOffsetMm: 0,
    });
  });

  it('normalizes points deterministically for profile and project persistence', () => {
    expect(
      normalizeRasterCalibration({
        enabled: true,
        initialXOffsetMm: 0.25,
        bidirectionalOffsetPoints: [
          { speedMmPerMin: 1200, offsetMm: 0.4 },
          { speedMmPerMin: -1, offsetMm: 1 },
          { speedMmPerMin: 800, offsetMm: 0.2 },
          { speedMmPerMin: 1200, offsetMm: 0.35 },
          { speedMmPerMin: 1000, offsetMm: Number.NaN },
        ],
        source: 'calibration-test',
        notes: '4040 test',
      }),
    ).toEqual({
      enabled: true,
      initialXOffsetMm: 0.25,
      bidirectionalOffsetPoints: [
        { speedMmPerMin: 800, offsetMm: 0.2 },
        { speedMmPerMin: 1200, offsetMm: 0.35 },
      ],
      source: 'calibration-test',
      notes: '4040 test',
    });
  });

  it('interpolates by speed and clamps outside the measured range', () => {
    const calibration = normalizeRasterCalibration({
      enabled: true,
      bidirectionalOffsetPoints: [
        { speedMmPerMin: 800, offsetMm: 0.2 },
        { speedMmPerMin: 1200, offsetMm: 0.4 },
      ],
    });

    expect(resolveRasterScanCalibration(calibration, 600).bidirectionalOffsetMm).toBeCloseTo(0.2);
    expect(resolveRasterScanCalibration(calibration, 1000).bidirectionalOffsetMm).toBeCloseTo(0.3);
    expect(resolveRasterScanCalibration(calibration, 1600).bidirectionalOffsetMm).toBeCloseTo(0.4);
  });

  it('maps a positive bidirectional offset ahead of each scan direction', () => {
    const resolved = { initialXOffsetMm: 0.1, bidirectionalOffsetMm: 0.25 };

    expect(scanAxisOffsetForDirection(resolved, 1)).toBeCloseTo(0.35);
    expect(scanAxisOffsetForDirection(resolved, -1)).toBeCloseTo(-0.15);
  });
});
