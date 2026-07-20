import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { FillGroup, RasterGroup } from './job';

const device = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
  estimateCutTimeScale: 1.75,
  estimateTravelTimeScale: 0.6,
};

const options = {
  initialPosition: { x: 0, y: 0.5 },
  finishPosition: null,
};

describe('raster duration run parity', () => {
  it('accounts a close S0 hole as feed travel without changing continuous sweep timing', () => {
    const raster = rasterGroup(new Uint16Array([500, 0, 500]));
    const emittedMotion = fillReference(
      [
        [0, 1],
        [2, 3],
      ],
      0,
    );

    expectEstimateParity(raster, emittedMotion);
  });

  it('accounts dot-width correction as laser-off feed motion around the shortened burn', () => {
    const raster = rasterGroup(new Uint16Array([500]), 0.25);
    const emittedMotion = fillReference([[0.25, 0.75]], 0.25);

    expectEstimateParity(raster, emittedMotion);
  });

  it('drops a powered DWC fragment that is stationary on the controller grid', () => {
    const raster: RasterGroup = {
      ...rasterGroup(new Uint16Array([500]), 0.0207),
      bounds: { minX: 1, minY: 1, maxX: 1.041667, maxY: 1.1 },
    };

    const estimate = estimateJobDuration({ groups: [raster] }, device, {
      initialPosition: { x: 1, y: 1.05 },
      finishPosition: null,
    });

    expect(estimate.breakdown.cutSeconds).toBe(0);
    expect(estimate.totalSeconds).toBe(estimate.breakdown.travelSeconds);
  });
});

function rasterGroup(sValues: Uint16Array, dotWidthCorrectionMm = 0): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#000',
    power: 50,
    speed: 1200,
    passes: 1,
    airAssist: false,
    sValues,
    pixelWidth: sValues.length,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: sValues.length, maxY: 1 },
    overscanMm: 0,
    dotWidthCorrectionMm,
    bidirectional: false,
  };
}

function fillReference(
  poweredRanges: ReadonlyArray<readonly [number, number]>,
  overscanMm: number,
): FillGroup {
  return {
    kind: 'fill',
    layerId: 'emitted-motion-reference',
    color: '#000',
    power: 50,
    speed: 1200,
    passes: 1,
    airAssist: false,
    overscanMm,
    fillRunwayPolicy: 'raster-bounded',
    segments: poweredRanges.map(([startX, endX]) => ({
      polyline: [
        { x: startX, y: 0.5 },
        { x: endX, y: 0.5 },
      ],
      closed: false,
      reverse: false,
    })),
  };
}

function expectEstimateParity(raster: RasterGroup, emittedMotion: FillGroup): void {
  const actual = estimateJobDuration({ groups: [raster] }, device, options);
  const expected = estimateJobDuration({ groups: [emittedMotion] }, device, options);

  expect(actual.breakdown.cutSeconds).toBeCloseTo(expected.breakdown.cutSeconds, 8);
  expect(actual.breakdown.feedTravelSeconds).toBeCloseTo(
    expected.breakdown.feedTravelSeconds ?? 0,
    8,
  );
  expect(actual.breakdown.rapidTravelSeconds).toBeCloseTo(
    expected.breakdown.rapidTravelSeconds ?? 0,
    8,
  );
  expect(actual.totalSeconds).toBeCloseTo(expected.totalSeconds, 8);
}
