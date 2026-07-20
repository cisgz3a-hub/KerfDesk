import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { RasterGroup } from './job';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
};

describe('raster duration scan-offset precedence', () => {
  it('preserves an explicit raster scan offset ahead of the profile table', () => {
    const raster = rasterGroup(0);
    const calibratedDevice = {
      ...device,
      scanningOffsets: [{ speedMmPerMin: raster.speed, offsetMm: 2 }],
    };
    const baseline = estimateJobDuration({ groups: [raster] }, device);
    const explicitlyUnshifted = estimateJobDuration({ groups: [raster] }, calibratedDevice);
    const profileShifted = estimateJobDuration({ groups: [rasterGroup()] }, calibratedDevice);

    expect(explicitlyUnshifted.totalSeconds).toBeCloseTo(baseline.totalSeconds, 8);
    expect(explicitlyUnshifted.breakdown.travelSeconds).toBeCloseTo(
      baseline.breakdown.travelSeconds,
      8,
    );
    expect(profileShifted.breakdown.travelSeconds).toBeGreaterThan(
      baseline.breakdown.travelSeconds,
    );
  });
});

function rasterGroup(bidirectionalScanOffsetMm?: number): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#808080',
    power: 30,
    speed: 1200,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array(8).fill(500),
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 10, minY: 20, maxX: 50, maxY: 30 },
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
    ...(bidirectionalScanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm }),
  };
}
